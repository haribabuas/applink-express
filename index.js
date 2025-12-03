const PORT = process.env.APP_PORT || 3000
const applinkSDK = require('@heroku/applink')
const express = require('express')
const app = express()

app.use(express.json())

app.get('/accounts', async (req, res) => {
    const sf = applinkSDK.parseRequest(req.headers, req.body, null).context.org.dataApi;

    const queryString = "SELECT Id, Name FROM Account LIMIT 10";

    const queryResult = await sf.query(queryString);
    const outAccounts = queryResult.records.map(rec => rec.fields);

    res.json(outAccounts);
})

app.post('/api/generatequotelinesTest', async (request, res) => {
    const { quoteId, sapLineIds } = request.body;
    console.log('Incoming request body:', request.body);
    console.log('@@@quoteId:', quoteId);
    console.log('@@@req.headers:', request.headers);
    request.sdk = applinkSDK.init();
    console.log('@@@request.sdk ',request.sdk );
   
  const sf = applinkSDK.parseRequest(request.headers, request.body, null);//.context.org.dataApi;
    console.log('@@@sf',sf);
    const queryString = "SELECT Id, Name FROM Account LIMIT 10";
    console.log('@@@sf',sf);
    const org = sf.context.org;
    console.log('@@@org',org);
    const queryResult = await org.dataApi.query(queryString); //sf.query(queryString);
    const outAccounts = queryResult.records.map(rec => rec.fields);
    console.log('@@@outAccounts',outAccounts);
    res.json(outAccounts);

})


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

  // ---------- Helpers ----------
  const chunkArray = (arr, size) => {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
    return chunks;
  };

  const getAdjustedStartDate = (endDateStr) => {
    const end = new Date(endDateStr);
    if (Number.isNaN(end.getTime())) return new Date();
    const start = new Date(end);
    start.setMonth(start.getMonth() - 12);
    return start;
  };

  try {
    // Correct single-quote escaping for SOQL literals: use ''
    const idsString = sapLineIds
      .map(id => `'${String(id).replace(/'/g, "''")}'`)
      .join(',');

    const query = `
      SELECT
        Id,
        License_Type__c,
        Quantity__c,
        End_Date_Consolidated__c,
        CPQ_Product__c,
        Install__c,
        CPQ_Product__r.Access_Range__c,
        Install__r.AccountID__c,
        Install__r.Partner_Account__c,
        Install__r.CPQ_Sales_Org__c
      FROM SAP_Install_Line_Item__c
      WHERE Id IN (${idsString})
    `;

    const sapRes = await org.dataApi.query(query);
    const sapLines = sapRes?.records ?? [];

    if (!sapLines.length) {
      return res.status(404).json({ error: 'No SAP install lines found' });
    }

    const quoteLinesToInsert = sapLines.map((lineItem) => {
      const f = lineItem.fields;

      const startDate = f.End_Date_Consolidated__c
        ? getAdjustedStartDate(f.End_Date_Consolidated__c)
        : new Date();

      const endDate = new Date(startDate);
      endDate.setMonth(endDate.getMonth() + 12);

      // Build payload using exact API names from SBQQ__QuoteLine__c
      const ql = {
        SBQQ__Quote__c: quoteId,
        SBQQ__Product__c: f.CPQ_Product__c,
        Install__c: f.Install__c,
        // Relationship fields read from query results:
        Access_Range__c: f.CPQ_Product__r?.fields?.Access_Range__c ?? null,
        Account__c: f.Install__r?.fields?.AccountID__c ?? null,
        Partner_Account__c: f.Install__r?.fields?.Partner_Account__c ?? null,
        Sales_Org__c: f.Install__r?.fields?.CPQ_Sales_Org__c ?? null,
        SBQQ__Quantity__c: f.Quantity__c,
        SBQQ__StartDate__c: startDate.toISOString().split('T')[0],
        SBQQ__EndDate__c: endDate.toISOString().split('T')[0],
        CPQ_License_Type__c: 'MAINT',
      };

      return ql;
    });

    console.log('@@@quoteLinesToInsert', quoteLinesToInsert);

    const batchSize = 200;
    const batches = chunkArray(quoteLinesToInsert, batchSize);
    const createdIds = [];

    for (const batch of batches) {
      const uow = org.dataApi.newUnitOfWork();
      const refs = [];

      for (const ql of batch) {
        const ref = uow.registerCreate('SBQQ__QuoteLine__c', ql);
        refs.push(ref);
      }

      const commitRes = await org.dataApi.commitUnitOfWork(uow);

      for (const ref of refs) {
        const result = commitRes.getResult(ref);
        if (result?.id) {
          createdIds.push(result.id);
        } else if (result?.errors?.length) {
          console.warn('Create error:', result.errors);
        }
      }
    }

    return res.json({
      message: 'Quote lines created in UnitOfWork batches',
      createdCount: createdIds.length,
    });

  } catch (err) {
    console.error('@@Error creating quote lines:', err);
    // Bubble up the most useful details when possible
    return res.status(500).json({
      error: err?.message || 'Unknown error',
      details: err?.response?.data ?? undefined,
    });
  }
});








function getAdjustedStartDate(dateStr) {
  const date = new Date(dateStr);
  date.setDate(date.getDate() + 1);
  return date;
}

app.listen(PORT, () => {
    console.log(`Listening on ${ PORT }`)
})
