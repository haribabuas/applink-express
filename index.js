
const PORT = process.env.APP_PORT || 3000;
const applinkSDK = require('@heroku/applink');
const express = require('express');
const app = express();
app.use(express.json());


app.post('/test/generatequotelines', async (req, res) => {
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
 
});



function chunkArray(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

app.post('/api/generatequotelines', async (req, res) => {
  const { quoteId, sapLineIds } = req.body;
  
  if (!quoteId || !sapLineIds?.length) {
    return res.status(400).json({ error: 'Missing required data' });
  }

  const sf = applinkSDK.parseRequest(req.headers, req.body, null);
  const org = sf.context.org;
  const dataApi = sf.context.org.dataApi;
  
    const idsString = sapLineIds
      .map(id => `'${String(id).replace(/'/g, "''")}'`)
      .join(',');
      const query = `SELECT Id, License_Type__c, Quantity__c, End_Date_Consolidated__c,
               CPQ_Product__c, Install__c,
               CPQ_Product__r.Access_Range__c,
               Install__r.AccountID__c, Install__r.Partner_Account__c, Install__r.CPQ_Sales_Org__c
        FROM SAP_Install_Line_Item__c
        WHERE Id IN (${idsString})`;
      
   /* const sapLineQueries = await dataApi.query(query);
     console.log('@@@sapLineQueries',sapLineQueries);
    const sapLines = sapLineQueries.records[0].fields;
    console.log('@@@saplines',sapLines);
    const uow = dataApi.newUnitOfWork();
    const refId = uow.registerCreate({
        type: 'SBQQ__QuoteLine__c',
        fields: {
            SBQQ__Product__c: sapLines.CPQ_Product__c,
            SBQQ__Quote__c: quoteId,
            Install__c: sapLines.Install__c,
            Access_Range__c: sapLines.CPQ_Product__r?.fields?.Access_Range__c,
            Account__c: sapLines.Install__r?.fields?.accountid__c,
            Partner_Account__c: sapLines.Install__r?.fields?.Partner_Account__c,
             Sales_Org__c: sapLines.Install__r?.fields?.CPQ_Sales_Org__c,
            SBQQ__Quantity__c: sapLines.Quantity__c,
            SBQQ__StartDate__c: startDate.toISOString().split('T')[0],
            SBQQ__EndDate__c: endDate.toISOString().split('T')[0],
            CPQ_License_Type__c: 'MAINT',
        },
    });*/

 const MAX_PER_COMMIT = 200;
 
const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};
   

const sapLineQueries = await dataApi.query(query);
console.log('@@@sapLineQueries', sapLineQueries);

const records = sapLineQueries?.records ?? [];

const batches = chunk(records, MAX_PER_COMMIT);
const allResults = [];
for (const [batchIdx, batch] of batches.entries()) {
    console.log(`@@@processing batch ${batchIdx + 1}/${batches.length} (size=${batch.length})`);
const refIds = [];
 const uow = dataApi.newUnitOfWork();
for (const [idx, rec] of batch.entries()) {
  const sapLines = rec?.fields;
  if (!sapLines) {
    console.warn(`Record ${idx} has no fields; skipping.`);
    continue;
  }

  const quantity = sapLines.Quantity__c;
  const productId = sapLines.CPQ_Product__c;
  const installId = sapLines.Install__c;     
  const accessRange = sapLines.CPQ_Product__r?.fields?.Access_Range__c;
  const salesOrg   = sapLines.Install__r?.fields?.CPQ_Sales_Org__c;

  const startDate = sapLines.End_Date_Consolidated__c
        ? getAdjustedStartDate(sapLines.End_Date_Consolidated__c)
        : new Date();
      const endDate = new Date(startDate);
      endDate.setMonth(endDate.getMonth() + 12);

  const refId = uow.registerCreate({
    type: 'SBQQ__QuoteLine__c',
    fields: {
      SBQQ__Product__c: productId,
      SBQQ__Quote__c: quoteId,
      Install__c: installId,
      SBQQ__Quantity__c: quantity,
      SBQQ__StartDate__c: startDate.toISOString().split('T')[0],
      SBQQ__EndDate__c: endDate.toISOString().split('T')[0],
      Access_Range__c: accessRange,
      Sales_Org__c: salesOrg,
      CPQ_License_Type__c: 'MAINT',
    },
  });

  refIds.push(refId);
}
 try {
    const response = await dataApi.commitUnitOfWork(uow);
    console.error('@@response ', response);
    console.log(`@@@commit OK for batch ${batchIdx + 1}`);
    //allResults.push({ batch: batchIdx + 1, refIds, res });
    } catch (err) {
    console.error(`@@@commit FAILED for batch ${batchIdx + 1}`, err);
    throw err; 
  }
}
    res.status(200).json({ message: 'Quote lines created'});
});



function getAdjustedStartDate(dateStr) {
  const date = new Date(dateStr);
  date.setDate(date.getDate() + 1);
  return date;
}


app.listen(PORT, () => {
  console.log(`Listening on ${PORT}`);
});
