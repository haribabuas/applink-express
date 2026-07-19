
const PORT = process.env.APP_PORT || 3000;
const applinkSDK = require('@heroku/applink');
const express = require('express');
const app = express();
app.use(express.json());

function chunkArray(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}


const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function commitWithRetry(dataApi, uow, {
  maxRetries = 6,
  baseDelayMs = 250,
} = {}) {
  let attempt = 0;
  while (true) {
    try {
      return await dataApi.commitUnitOfWork(uow);
    } catch (e) {
      const msg = String(e?.message || e);
		console.log('@@@@',msg);
      const isLock = /UNABLE_TO_LOCK_ROW/i.test(msg);
      if (!isLock || attempt >= maxRetries) throw e;

      const delay = baseDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 200);
      attempt += 1;
      console.warn(`commitWithRetry: lock hit; retry ${attempt}/${maxRetries} after ${delay}ms`);
      await sleep(delay);
    }
  }
}

app.post('/api/generatequotelines', async (req, res, next) => {
 
const { quoteId,sapLineIds,lineIds,listStr,bolFlag} = req.body;
const sf = applinkSDK.parseRequest(req.headers, req.body, null);
const dataApi = sf.context.org.dataApi;
 const jobId = `${quoteId}-${Date.now()}`;
  res.status(202).json({
    status: 'accepted',
    jobId
  });

  // Continue work asynchronously (off the request lifecycle)
  process.nextTick(() => {
    if (bolFlag === true) {
      processCloneQuoteLinesAsync({
        quoteId,
        lineIds,
        listStr,
        dataApi,
        jobId
      });

    } else {
      processQuoteLinesAsync({
        quoteId,
        sapLineIds,
        dataApi,
        jobId
      });
    }
  });
});

async function processQuoteLinesAsync({ quoteId, sapLineIds, dataApi, jobId }) {
  try {
    const roundHalfUp = (value, decimals = 2) => {
      if (value == null || isNaN(Number(value))) return 0;
      const sign = value < 0 ? -1 : 1;
      const abs = Math.abs(Number(value));
      const factor = Math.pow(10, decimals);
      return sign * (Math.round((abs + Number.EPSILON) * factor) / factor);
    };

    const normalizeSerialQty = (listStr) => {
      if (!listStr || typeof listStr !== 'string' || listStr.trim() === '') return undefined;
      const parts = listStr.split(',');
      const normalized = [];
      for (const p of parts) {
        const pair = p.split(':');
        if (pair.length === 2) {
          let serial = String(pair[0] || '').replace(/^0+/, '');
          if (serial === '') serial = '0';
          const qty = pair[1];
          normalized.push(`${serial}:${qty}`);
        }
      }
      return normalized.length ? normalized.join(';') : undefined;
    };

    const safeDate = (d) => {
      if (!d) return null;
      const date = new Date(d);
      return isNaN(date.getTime()) ? null : date;
    };

    const MAX_IDS_PER_QUERY = 500;
    const chunk = (arr, size) => {
      const out = [];
      for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
      return out;
    };

    const idChunks = chunk(sapLineIds, MAX_IDS_PER_QUERY);
    const allRecords = [];

    for (const [cIdx, ids] of idChunks.entries()) {
      const idsString = ids.map(id => `'${String(id).replace(/'/g, "''")}'`).join(',');

      const query = `
        SELECT Id,
               License_Type__c, Quantity__c, End_Date_Consolidated__c, O2O_Attribute_Discount__c,
               CPQ_Product__c, Install__c, Maint_Tier_Level__c, SAP_LI_Equipment_Numbers__c,
               CPQ_Product__r.Global__c, Install__r.Price_List_Type__c, Access_Range__c,  CPQ_Product__r.Access_Range__c,
               SAP_SYNC_ID__c, Prior_Quantity__c, ACV_12_Mth__c, Install__r.AccountID__c,
               Install__r.Partner_Account__c, Install__r.CPQ_Sales_Org__c,Support_Level__c,Territory__c,
               Monthly_Net_Maint__c,
               List_of_Serial_Qty__c,
               Expiration_Date__c,
               CPQ_Product__r.Subtech_Pricing__c,
               CPQ_Product__r.External_Material_Group__c

        FROM SAP_Install_Line_Item__c
        WHERE Id IN (${idsString})
      `;

      const sapLineQueries = await dataApi.query(query);
      const records = sapLineQueries?.records ?? [];
      console.log(`@@@query chunk ${cIdx + 1}/${idChunks.length} => ${records.length} records`);
      allRecords.push(...records);
    }

    const priceLists = new Set();
    const subTechs   = new Set();
    const emgs       = new Set();

    let minExp = null;
    let maxExp = null;

    for (const rec of allRecords) {
      const sl = rec?.fields || {};
      const install = sl.Install__r?.fields || {};
      const product = sl.CPQ_Product__r?.fields || {};

      if (install.Price_List_Type__c) priceLists.add(install.Price_List_Type__c);
      if (product.Subtech_Pricing__c)  subTechs.add(product.Subtech_Pricing__c);
      if (product.External_Material_Group__c) emgs.add(product.External_Material_Group__c);

      
      const expDate =
        safeDate(sl.Expiration_Date__c) ||
        safeDate(sl.End_Date_Consolidated__c);
      if (expDate) {
        if (!minExp || expDate < minExp) minExp = expDate;
        if (!maxExp || expDate > maxExp) maxExp = expDate;
      }
    }

    
    let pfByKey = new Map();
    if (priceLists.size && subTechs.size && emgs.size) {
      const vals = (set) => Array.from(set).map(v => `'${String(v).replace(/'/g, "''")}'`).join(',');


      const pfQuery = `
        SELECT Id, Price_List__c, Product_Template__c, Sub_Technology__c,
               Start_Date__c, End_Date__c, Renewal_Uplift__c, LastModifiedDate
        FROM Pricing_Factors__c
        WHERE Price_List__c IN (${vals(priceLists)})
          AND Sub_Technology__c IN (${vals(subTechs)})
          AND Product_Template__c IN (${vals(emgs)})
        ORDER BY Start_Date__c DESC, LastModifiedDate DESC
      `;

      const pfResult = await dataApi.query(pfQuery);
      const pfRecords = pfResult?.records ?? [];

      // Group PFs by composite key
      pfByKey = new Map();
      for (const r of pfRecords) {
        const pf = r?.fields || {};
        const key = `${pf.Price_List__c}|${pf.Sub_Technology__c}|${pf.Product_Template__c}`;
        if (!pfByKey.has(key)) pfByKey.set(key, []);
        pfByKey.get(key).push(pf);
      }
    }
    const MAX_PER_COMMIT = 200;
    const recordBatches = chunk(allRecords, MAX_PER_COMMIT);

    for (const [batchIdx, batch] of recordBatches.entries()) {
      console.log(`@@@processing batch ${batchIdx + 1}/${recordBatches.length} (size=${batch.length})`);
      const uow = dataApi.newUnitOfWork();

      for (const rec of batch) {
        const sl = rec?.fields;
        if (!sl) continue;

        const productId        = sl.CPQ_Product__c;
        const installId        = sl.Install__c;
        const quantity         = sl.Quantity__c;
        const accessRange      = sl.Access_Range__c;
        const salesOrg         = sl.Install__r?.fields?.CPQ_Sales_Org__c;
        const accountId        = sl.Install__r?.fields?.AccountID__c;
        const partnerAccountId = sl.Install__r?.fields?.Partner_Account__c;
        const maintTierLevel   = sl.Maint_Tier_Level__c;

        const licenseMap  = { 'QA-Test': 'TESTM', 'Backup': 'BKUPM' };
        const licenseType = licenseMap[sl?.License_Type__c] || 'MAINT';

        const equipmentNumber =
          sl.SAP_LI_Equipment_Numbers__c?.trim()
            ? sl.SAP_LI_Equipment_Numbers__c.trim()
            : (sl.SAP_SYNC_ID__c?.trim() ? sl.SAP_SYNC_ID__c.trim() : '');

        let globalPricing = false;
        if (sl?.CPQ_Product__r?.fields?.Global__c === 'Yes' &&
            (sl?.Install__r?.fields?.Price_List_Type__c === 'GE' ||
             sl?.Install__r?.fields?.Price_List_Type__c === 'GU')) {
          globalPricing = true;
        }

        
        const monthlyNet = sl.Monthly_Net_Maint__c == null ? 0 : Number(sl.Monthly_Net_Maint__c);
        const defaultUpliftPct = 15;

        const install = sl.Install__r?.fields || {};
        const product = sl.CPQ_Product__r?.fields || {};
        const expDate =
          safeDate(sl.Expiration_Date__c) ||
          safeDate(sl.End_Date_Consolidated__c);

      
        let upliftPct = defaultUpliftPct;
        const pfKey = `${install.Price_List_Type__c || ''}|${product.Subtech_Pricing__c || ''}|${product.External_Material_Group__c || ''}`;
        const pfCandidates = pfByKey.get(pfKey) || [];

        if (expDate && pfCandidates.length) {
          for (const pf of pfCandidates) {
            const start = safeDate(pf.Start_Date__c);
            const end   = safeDate(pf.End_Date__c);
            const startsOk = !start || start <= expDate;
            const endsOk   = !end || end >= expDate;
            if (startsOk && endsOk) {
              if (pf.Renewal_Uplift__c != null) {
                upliftPct = Number(pf.Renewal_Uplift__c);
              }
              break; 
            }
          }
        }

        const maxListUnitPrice = roundHalfUp(monthlyNet * (1 + upliftPct / 100), 2);

        const serialNormalized = normalizeSerialQty(sl.List_of_Serial_Qty__c);
        const startDate = sl.End_Date_Consolidated__c
          ? getAdjustedStartDate(sl.End_Date_Consolidated__c)
          : new Date();
        const endDate = new Date(startDate);
        endDate.setMonth(endDate.getMonth() + 12);

    
        uow.registerCreate({
          type: 'SBQQ__QuoteLine__c',
          fields: {
            SBQQ__Product__c: productId,
            SBQQ__Quote__c: quoteId,
            Install__c: installId,
            Account__c: accountId,
            Partner_Account__c: partnerAccountId,
            Maint_Tier_Level__c: maintTierLevel,
            SBQQ__Quantity__c: quantity,
            Prior_Equipment__c: equipmentNumber,
            O2O_Attribute_Quantity__c: sl.Prior_Quantity__c,
            Prior_ACV_12_Mth__c: sl.ACV_12_Mth__c,
            O2O_Attribute_Percent__c: sl.O2O_Attribute_Discount__c,
            Global_Pricing__c: globalPricing,
            SBQQ__StartDate__c: startDate.toISOString().split('T')[0],
            SBQQ__EndDate__c: endDate.toISOString().split('T')[0],
            Access_Range__c: accessRange,
            Sales_Org__c: salesOrg,
            Support_Level__c: sl.Support_Level__c,
            Territory__c: sl.Territory__c,
            CPQ_License_Type__c: licenseType,
            SBQQ__MaximumPrice__c: maxListUnitPrice,
            Monthly_Net_Maint__c: monthlyNet,
            Serial_Number_Actual__c: sl.List_of_Serial_Qty__c,   		  
            Serial_Number__c: sl.List_of_Serial_Qty__c //serialNormalized
          },
        });
      }

      try {
       // const response = await dataApi.commitUnitOfWork(uow);
        const resMap = await commitWithRetry(dataApi, uow);
        console.log(`@@@commit OK for batch ${batchIdx + 1}`);
      } catch (err) {
        console.error(`@@@commit FAILED for batch ${batchIdx + 1}`, err);
        // collect failed records
        await logFailedBatchAsJson({
          dataApi,  
          quoteId,
          failedRecords: batch,
          err
        });
      }
    }
	const statusUow = dataApi.newUnitOfWork();
	const updRef = statusUow.registerUpdate({
	    type: 'SBQQ__Quote__c',
	    fields: { 
		  id: quoteId,	
		  Process_through_Heroku__c: true	
		}
		});
	console.log('@@@updRef',updRef);
     const results = await dataApi.commitUnitOfWork(statusUow);
  } catch (err) {
    console.error(`>>> [Job ${jobId}] FAILED:`, err);
  }
}

async function processCloneQuoteLinesAsync({
  quoteId,
  lineIds,
  listStr,
  dataApi,
  jobId
}) {

  try {

    console.log(`Starting Clone Job ${jobId}`);
    console.log(
      `Found ${lineIds.length} quote lines to clone`
    );
    if (!Array.isArray(lineIds) || lineIds.length === 0) {
      throw new Error('lineIds missing');
    }

    const creatableFields = Array.isArray(listStr)
  ? listStr.map(f => String(f).trim()).filter(Boolean)
  : [];

    const CLONE_FIELDS_EXCLUDE = [
      'Id',
	    'SBQQ__Quote__c',
      'OwnerId',
      'CreatedDate',
      'CreatedById',
      'LastModifiedDate',
      'LastModifiedById',
      'SystemModstamp'
    ];

    const MAX_IDS_PER_QUERY = 500;

    const idChunks = chunkArray(
      lineIds,
      MAX_IDS_PER_QUERY
    );

    const allQuoteLines = [];

    for (const [chunkIndex, ids] of idChunks.entries()) {

      const idsString = ids
        .map(id => `'${String(id).replace(/'/g, "''")}'`)
        .join(',');

      const query = `
        SELECT Id,
              ${creatableFields.join(',')}
        FROM SBQQ__QuoteLine__c
        WHERE Id IN (${idsString})
      `;

      const quoteLineResult = await dataApi.query(query);

      const records = quoteLineResult?.records || [];

      console.log(
        `QuoteLine Query Chunk ${chunkIndex + 1}/${idChunks.length} => requested=${ids.length}, returned=${records.length}`
      );

      allQuoteLines.push(...records);
    }

    console.log(
      `Total Input IDs: ${lineIds.length}`
    );

    console.log(
      `Total Quote Lines Retrieved: ${allQuoteLines.length}`
    );

    console.log(
      `Found ${allQuoteLines.length} quote lines to clone`
    );

    const batchSize = 200;

    const batches = chunkArray(
      allQuoteLines,
      batchSize
    );

    const originalToCloneMap = new Map();

    for (const [batchIdx, batch] of batches.entries()) {

      const uow = dataApi.newUnitOfWork();

      const localMapping = [];

      for (const record of batch) {

        const src = record.fields || {};

        const cloneFields = {};

        for (const field of creatableFields) {

          if (
            !CLONE_FIELDS_EXCLUDE.includes(field) &&
            src[field] !== undefined
          ) {
            cloneFields[field] = src[field];
          }
        }

        cloneFields.SBQQ__Source__c = src.Id;
        cloneFields.Cloned_From_Required_By__c =
          src.SBQQ__RequiredBy__c;

        cloneFields.SBQQ__Quote__c = quoteId;

        const ref = uow.registerCreate({
          type: 'SBQQ__QuoteLine__c',
          fields: cloneFields
        });

        localMapping.push({
          sourceId: src.Id,
          ref
        });
      }

      try {

        const commitResult =
          await commitWithRetry(dataApi, uow);

        console.log(
          `Clone batch ${batchIdx + 1} committed`
        );

        if (
          commitResult &&
          commitResult.results
        ) {

          commitResult.results.forEach(
            (result, idx) => {

              if (result.id) {

                originalToCloneMap.set(
                  localMapping[idx].sourceId,
                  result.id
                );
              }
            }
          );
        }

      } catch (err) {

        console.error(
          `Clone batch ${batchIdx + 1} failed`,
          err
        );

        await logFailedBatchAsJson({
          dataApi,
          quoteId,
          failedRecords: batch,
          err
        });
      }
    }

    console.log(
      'Original -> Clone Mapping Size:',
      originalToCloneMap.size
    );

  } catch (err) {

    console.error(
      `Clone Job ${jobId} Failed`,
      err
    );
  }
}

async function logFailedBatchAsJson({dataApi, quoteId, failedRecords, err}) {
  const errorMessage = String(err?.message || err || 'Unknown error');
  const errorCode = errorMessage.includes('UNABLE_TO_LOCK_ROW') ? 'UNABLE_TO_LOCK_ROW' : 'ERROR';
  const failedIds = failedRecords.map(r => r?.fields?.Id).filter(Boolean);

  const uow = dataApi.newUnitOfWork();
  uow.registerCreate({
    type: 'ErrorLog__c',
    fields: {
      ProcessStatus__c: 'Failed',
      Sfdc_Error_Code__c: errorCode,
      ErrorDescription__c: errorMessage,
      //QuoteIdRevision__c: quoteId,
      Json_Payload__c: JSON.stringify({
        sapLineIds: failedIds,
        batchSize: failedRecords.length
      }),
    },
  });

  await dataApi.commitUnitOfWork(uow);
}


function chunk(arr, size) { const out = []; for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size)); return out; }
async function withTimeout(promise, ms) {
  const t = new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms));
  return Promise.race([promise, t]);
}


function getAdjustedStartDate(dateStr) {
  const date = new Date(dateStr);
  date.setDate(date.getDate() + 1);
  return date;
}


app.listen(PORT, () => {
  console.log(`Listening on ${PORT}`);
});
