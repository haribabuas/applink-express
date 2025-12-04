
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

  try {
    const idsString = sapLineIds
      .map(id => `'${String(id).replace(/'/g, "''")}'`)
      .join(',');
      const query = `
        SELECT Id, License_Type__c, Quantity__c, End_Date_Consolidated__c,
               CPQ_Product__c, Install__c,
               CPQ_Product__r.Access_Range__c,
               Install__r.AccountID__c, Install__r.Partner_Account__c, Install__r.CPQ_Sales_Org__c
        FROM SAP_Install_Line_Item__c
        WHERE Id IN (${idsString})
      `;
      
    const sapLineQueries = await org.dataApi.query(query);
    const saplines = sapLineQueries.records[0].fields;
    console.log(`Total SAP lines fetched: ${saplines.length}`);
    const uow = dataApi.newUnitOfWork();
    const refId = uow.registerCreate({
        type: 'SBQQ__QuoteLine__c',
        fields: {
            SBQQ__Product__c: sapLines.CPQ_Product__c,
            SBQQ__Quote__c: quoteId,
            Install__c: sapLines.Install__c,
            //Access_Range__c: sapLines.CPQ_Product__r?.fields?.Access_Range__c,
            //Account__c: sapLines.Install__r?.fields?.accountid__c,
            //Partner_Account__c: sapLines.Install__r?.fields?.Partner_Account__c,
             // Sales_Org__c: sapLines.Install__r?.fields?.CPQ_Sales_Org__c,
            SBQQ__Quantity__c: sapLines.Quantity__c,
            //SBQQ__StartDate__c: startDate.toISOString().split('T')[0],
            //SBQQ__EndDate__c: endDate.toISOString().split('T')[0],
            CPQ_License_Type__c: 'MAINT',
        },
    });

    const response = await org.dataApi.commitUnitOfWork(uow);
    console.error('@@response ', response);
    res.status(200).json({ message: 'Quote lines created'});
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
  console.log(`Listening on ${PORT}`);
});
