
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


app.post('/api/generatequotelines', async (req, res) => {
  const { quoteId, sapLineIds } = req.body;
  if (!quoteId || !Array.isArray(sapLineIds) || sapLineIds.length === 0) {
    return res.status(400).json({ error: 'Missing required data' });
  }
  const jobId = crypto.randomUUID();
  

  const sf = applinkSDK.parseRequest(req.headers, req.body, null);
  const dataApi = sf.context.org.dataApi;
  const respql = await generateQuoteLines({ dataApi, quoteId, sapLineIds });
  console.log('@@@respql',respql);
   return res.status(503).json({
    message: 'Quote lines created successfully',
    recordsProcessed: respql
  });
/*try {
  const respql = await generateQuoteLines({ dataApi, quoteId, sapLineIds });
  return res.status(200).json({
    message: 'Quote lines created successfully',
    recordsProcessed: respql,
  });
} catch (err) {
  console.error('Error generating quote lines:', err);
  return res.status(503).json({
    error: 'Internal Server Error',
    details: err.message || String(err),
  });
}*/

});

async function generateQuoteLines({ dataApi, quoteId, sapLineIds }) {
  const MAX_IDS_PER_QUERY = 75;
  const MAX_PER_COMMIT = 50;
  const QUERY_CONCURRENCY = 4;  
  const COMMIT_CONCURRENCY = 3; 

  const chunk = (arr, size) => Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

  const fields = [
    'Id', 'License_Type__c', 'Quantity__c', 'End_Date_Consolidated__c', 'O2O_Attribute_Discount__c',
    'CPQ_Product__c', 'Install__c', 'Maint_Tier_Level__c', 'SAP_LI_Equipment_Numbers__c', 'SAP_SYNC_ID__c',
    'Prior_Quantity__c', 'ACV_12_Mth__c',
    'CPQ_Product__r.Global__c', 'CPQ_Product__r.Access_Range__c',
    'Install__r.Price_List_Type__c', 'Install__r.AccountID__c', 'Install__r.Partner_Account__c', 'Install__r.CPQ_Sales_Org__c'
  ].join(', ');

  const idChunks = chunk(sapLineIds, MAX_IDS_PER_QUERY);

  const queries = idChunks.map((ids) => {
    const idsString = ids.map(id => `'${String(id).replace(/'/g, "''")}'`).join(',');
    return `SELECT ${fields} FROM SAP_Install_Line_Item__c WHERE Id IN (${idsString})`;
  });

  const runLimited = async (items, limit, handler) => {
    const results = [];
    let i = 0;
    const workers = Array.from({ length: limit }, async () => {
      while (i < items.length) {
        const idx = i++;
        const r = await handler(items[idx], idx);
        results.push(r);
      }
    });
    await Promise.all(workers);
    return results.flat();
  };

  const allRecords = await runLimited(queries, QUERY_CONCURRENCY, async (q, qIdx) => {
    const resp = await dataApi.query(q);
    const recs = resp?.records ?? [];
    console.log(`@@@query chunk ${qIdx + 1}/${queries.length} => ${recs.length} records`);
    return recs;
  });

  const licenseMap = { 'QA-Test': 'TESTM', 'Backup': 'BKUPM' };
  const toISODate = (d) => new Date(d).toISOString().split('T')[0];

  const quoteLineInputs = allRecords
    .map((rec) => rec?.fields)
    .filter(Boolean)
    .map((sl) => {
      const quantity         = sl.Quantity__c;
      const productId        = sl.CPQ_Product__c;
      const installId        = sl.Install__c;
      const accessRange      = sl.CPQ_Product__r?.fields?.Access_Range__c;
      const salesOrg         = sl.Install__r?.fields?.CPQ_Sales_Org__c;
      const accountId        = sl.Install__r?.fields?.AccountID__c;
      const partnerAccountId = sl.Install__r?.fields?.Partner_Account__c;
      const maintTierLevel   = sl.Maint_Tier_Level__c;

      const licenseType = licenseMap[sl?.License_Type__c] || 'MAINT';

      const equipmentNumber =
        sl.SAP_LI_Equipment_Numbers__c?.trim()
          ? sl.SAP_LI_Equipment_Numbers__c.trim()
          : (sl.SAP_SYNC_ID__c?.trim() ? sl.SAP_SYNC_ID__c.trim() : '');

      const globalPricing =
        sl?.CPQ_Product__r?.Global__c === 'Yes' &&
        (sl?.Install__r?.Price_List_Type__c === 'GE' || sl?.Install__r?.Price_List_Type__c === 'GU');

      const startDate = sl.End_Date_Consolidated__c
        ? getAdjustedStartDate(sl.End_Date_Consolidated__c)
        : new Date();
      const endDate = new Date(startDate);
      endDate.setMonth(endDate.getMonth() + 12);

      return {
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
          SBQQ__StartDate__c: toISODate(startDate),
          SBQQ__EndDate__c: toISODate(endDate),
          Access_Range__c: accessRange,
          Sales_Org__c: salesOrg,
          CPQ_License_Type__c: licenseType,
        },
      };
    });

  const batches = chunk(quoteLineInputs, MAX_PER_COMMIT);

  const commitResults = await runLimited(batches, COMMIT_CONCURRENCY, async (batch, bIdx) => {
    console.log(`@@@processing batch ${bIdx + 1}/${batches.length} (size=${batch.length})`);
    const uow = dataApi.newUnitOfWork({
    });

    batch.forEach((input) => uow.registerCreate(input));

    const resp = await dataApi.commitUnitOfWork(uow);
    console.log(`@@@commit OK for batch ${bIdx + 1}`);
    return resp;
  });

  const totalProcessed = quoteLineInputs.length;
  console.log(`@@@Done. Quote lines created: ${totalProcessed}`);
  return totalProcessed;
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
