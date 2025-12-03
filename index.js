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
    // Safely format IDs for SOQL
    const idsString = sapLineIds.map(id => `'${id}'`).join(',');

    const query = `
      SELECT Id, License_Type__c, Quantity__c, End_Date_Consolidated__c,
             CPQ_Product__c, Install__c,
             CPQ_Product__r.Access_Range__c,
             Install__r.AccountID__c, Install__r.Partner_Account__c, Install__r.CPQ_Sales_Org__c
      FROM SAP_Install_Line_Item__c
      WHERE Id IN (${idsString})
    `;

    const sapLineQueries = await org.dataApi.query(query);

    console.log('@@@sapLineQueries', sapLineQueries);

    res.json({ message: 'Quote lines created', data: sapLineQueries.records });
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
