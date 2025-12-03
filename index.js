const PORT = process.env.APP_PORT || 3000
const applinkSDK = require('@heroku/applink')
const express = require('express')
const app = express()
app.use(express.json())

app.post('/api/generatequotelines', async (req, res) => {
  const { quoteId, sapLineIds } = req.body;

  if (!quoteId || !sapLineIds?.length) {
    return res.status(400).json({ error: 'Missing required data' });
  }

  const sf = applinkSDK.parseRequest(req.headers, req.body, null);
  const org = sf.context.org;

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
    const sapLines = sapRes.records[0].fields;

    const uow = org.dataApi.newUnitOfWork();
    const refId = uow.registerCreate('SBQQ__QuoteLine__c', {
      SBQQ__Product__c: sapLines.CPQ_Product__c,
        SBQQ__Quote__c: quoteId,
        Install__c: sapLines.Install__c,
        Access_Range__c: sapLines.CPQ_Product__r?.Access_Range__c,
        Account__c: sapLines.Install__r?.AccountID__c,
        Partner_Account__c: sapLines.Install__r?.Partner_Account__c,
        Sales_Org__c: sapLines.Install__r?.CPQ_Sales_Org__c,
        SBQQ__Quantity__c: sapLines.Quantity__c,
        //SBQQ__StartDate__c: startDate.toISOString().split('T')[0],
        //SBQQ__EndDate__c: endDate.toISOString().split('T')[0],
        CPQ_License_Type__c: 'MAINT'
    });

    const commitResult = await org.dataApi.commitUnitOfWork(uow);

   res.json({
      newAccountId: commitResult.getRefId(refId).id
    });

});








function getAdjustedStartDate(dateStr) {
  const date = new Date(dateStr);
  date.setDate(date.getDate() + 1);
  return date;
}

app.listen(PORT, () => {
    console.log(`Listening on ${ PORT }`)
})
