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

  try {
    const sapLineChunks = chunkArray(sapLineIds, 200);

    const sapLineQueries = sapLineChunks.map(chunk => {
      const query = `
        SELECT Id, License_Type__c, Quantity__c, End_Date_Consolidated__c,
               CPQ_Product__c, Install__c,
               CPQ_Product__r.Access_Range__c,
               Install__r.AccountID__c, Install__r.Partner_Account__c, Install__r.CPQ_Sales_Org__c
        FROM SAP_Install_Line_Item__c
        WHERE Id IN (${chunk.map(id => `'${id}'`).join(',')})
      `;
      return org.dataApi.query(query);
    });

    const queryResults = await Promise.all(sapLineQueries);
    const allSapLines = queryResults.flatMap(result => result.records);
    console.log(`Total SAP lines fetched: ${allSapLines.length}`);
    const quoteLinesToInsert = allSapLines.map(lineItem => {
      const startDate = lineItem.End_Date_Consolidated__c
        ? getAdjustedStartDate(lineItem.End_Date_Consolidated__c)
        : new Date();
      const endDate = new Date(startDate);
      endDate.setMonth(endDate.getMonth() + 12);

      return {
        SBQQ__Product__c: lineItem.CPQ_Product__c,
        SBQQ__Quote__c: quoteId,
        Install__c: lineItem.Install__c,
        Access_Range__c: lineItem.CPQ_Product__r?.Access_Range__c,
        Account__c: lineItem.Install__r?.AccountID__c,
        Partner_Account__c: lineItem.Install__r?.Partner_Account__c,
        Sales_Org__c: lineItem.Install__r?.CPQ_Sales_Org__c,
        SBQQ__Quantity__c: lineItem.Quantity__c,
        SBQQ__StartDate__c: startDate.toISOString().split('T')[0],
        SBQQ__EndDate__c: endDate.toISOString().split('T')[0],
        CPQ_License_Type__c: 'MAINT'
      };
    });

    const batches = chunkArray(quoteLinesToInsert, 200);
    const results = [];

    for (const batch of batches) {
      const result = await org.dataApi.sobject('SBQQ__QuoteLine__c').create(batch);
      results.push(...result);
    }
    console.error('@@Results ', results);
    res.status(200).json({ message: 'Quote lines created', totalInserted: results.length });
  } catch (err) {
    console.error('@@Error creating quote lines:', err);
    res.status(500).json({ error: err.message });
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
