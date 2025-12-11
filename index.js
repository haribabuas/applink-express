
const PORT = process.env.APP_PORT || 3000;
const applinkSDK = require('@heroku/applink');
const express = require('express');
const app = express();
app.use(express.json());

/*app.post('/test/generatequotelines', async (req, res) => {
  const { quoteId, sapLineIds } = req.body;

    const sf = applinkSDK.parseRequest(req.headers, req.body, null);
    const org = sf.context.org;
    const dataApi = sf.context.org.dataApi;
    console.log('@@@Org Context:', dataApi);

    const uow = dataApi.newUnitOfWork();
    const accountId = uow.registerCreate({
        type: 'Account',
        fields: {
          Name: 'Test Account',
        },
      });

    const response = await dataApi.commitUnitOfWork(uow);
    
console.log('@@@Org result:', response);
    res.json({
      message: 'Account created successfully'
    });
 
});*/

function chunkArray(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}



//const crypto = require('crypto');

app.post('/api/generatequotelines', async (req, res, next) => {
  try {
    const { quoteId, sapLineIds } = req.body;
    if (!quoteId || !Array.isArray(sapLineIds) || sapLineIds.length === 0) {
      return res.status(400).json({ error: 'Missing required data' });
    }

    const sf = applinkSDK.parseRequest(req.headers, req.body, null);
    const dataApi = sf.context.org.dataApi;

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

      const query = `SELECT Id, License_Type__c, Quantity__c, End_Date_Consolidated__c, O2O_Attribute_Discount__c,
                     CPQ_Product__c, Install__c, Maint_Tier_Level__c, SAP_LI_Equipment_Numbers__c, CPQ_Product__r.Global__c,
                     Install__r.Price_List_Type__c, CPQ_Product__r.Access_Range__c, SAP_SYNC_ID__c, Prior_Quantity__c, ACV_12_Mth__c,
                     Install__r.AccountID__c, Install__r.Partner_Account__c, Install__r.CPQ_Sales_Org__c
                     FROM SAP_Install_Line_Item__c
                     WHERE Id IN (${idsString})`;

      const sapLineQueries = await dataApi.query(query);
      const records = sapLineQueries?.records ?? [];
      console.log(`@@@query chunk ${cIdx + 1}/${idChunks.length} => ${records.length} records`);
      allRecords.push(...records);
    }

    const MAX_PER_COMMIT = 200;
    const recordBatches = chunk(allRecords, MAX_PER_COMMIT);

    for (const [batchIdx, batch] of recordBatches.entries()) {
      console.log(`@@@processing batch ${batchIdx + 1}/${recordBatches.length} (size=${batch.length})`);
      const uow = dataApi.newUnitOfWork();

      for (const rec of batch) {
        const sl = rec?.fields;
        if (!sl) continue;

        const quantity         = sl.Quantity__c;
        const productId        = sl.CPQ_Product__c;
        const installId        = sl.Install__c;
        const accessRange      = sl.CPQ_Product__r?.fields?.Access_Range__c;
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
        if (sl?.CPQ_Product__r?.Global__c === 'Yes' &&
            (sl?.Install__r?.Price_List_Type__c === 'GE' || sl?.Install__r?.Price_List_Type__c === 'GU')) {
          globalPricing = true;
        }

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
            CPQ_License_Type__c: licenseType,
          },
        });
      }

      try {
        const response = await dataApi.commitUnitOfWork(uow);
        console.log(`@@@commit OK for batch ${batchIdx + 1}`);
      } catch (err) {
        console.error(`@@@commit FAILED for batch ${batchIdx + 1}`, err);

        await logFailedBatchAsJson({
          quoteId,
          failedRecords: batch,
          err
        });
      }
    }

    return res.status(200).json({ message: 'Quote lines created', recordsProcessed: allRecords.length });
  } catch (err) {
    console.error('generatequotelines failed', err);
    return res.status(500).json({ error: 'Internal error', details: String(err?.message || err) });
  }
});


async function logFailedBatchAsJson({ quoteId, failedRecords, err}) {
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
      QuoteIdRevision__c: quoteId,
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
