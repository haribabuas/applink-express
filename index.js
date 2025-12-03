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
    const sapLines = sapRes?.records ?? [];

    if (!sapLines.length) {
      return res.status(404).json({ error: 'No SAP install lines found' });
    }

    const quoteLinesToInsert = sapLines.map((lineItem) => {
      const f = lineItem.fields;

      // Helper function to clean strings (already in your code)
      const cleanString = (str) => {
        if (typeof str === 'string') {
          // Replace smart quotes, non-breaking spaces, and trim whitespace
          return str.replace(/[“”‘’]/g, '"').replace(/\u00A0/g, ' ').trim();
        }
        return str; // Return null, numbers, etc. as is
      };

      const startDate = f.End_Date_Consolidated__c
        ? getAdjustedStartDate(f.End_Date_Consolidated__c)
        : new Date();

      const endDate = new Date(startDate);
      endDate.setMonth(endDate.getMonth() + 12);

      // Build payload using exact API names from SBQQ__QuoteLine__c
      const ql = {
        SBQQ__Quote__c: quoteId,
        SBQQ__Product__c: cleanString(f.CPQ_Product__c),
        Install__c: cleanString(f.Install__c),
        // Apply cleaning to all potential string fields
        Access_Range__c: cleanString(f.CPQ_Product__r?.fields?.Access_Range__c ?? null),
        Account__c: cleanString(f.Install__r?.fields?.AccountID__c ?? null),
        Partner_Account__c: cleanString(f.Install__r?.fields?.Partner_Account__c ?? null),
        Sales_Org__c: cleanString(f.Install__r?.fields?.CPQ_Sales_Org__c ?? null),
        SBQQ__Quantity__c: f.Quantity__c,
        SBQQ__StartDate__c: startDate.toISOString().split('T')[0],
        SBQQ__EndDate__c: endDate.toISOString().split('T')[0],
        CPQ_License_Type__c: 'MAINT',
      };

      return ql;
    });

    // Remove the console log that outputs non-strict JS objects.
    // console.log('@@@quoteLinesToInsert', quoteLinesToInsert); 

    const createdIds = [];
    const uow = org.dataApi.newUnitOfWork();
    const refs = [];

    // Register all quote lines in a single Unit of Work
    for (const ql of quoteLinesToInsert) {
      const ref = uow.registerCreate('SBQQ__QuoteLine__c', ql);
      refs.push(ref);
    }

      console.log(`Attempting to commit ${quoteLinesToInsert.length} records in a single transaction.`);
      const commitRes = await org.dataApi.commitUnitOfWork(uow);

      // Process results if successful
      for (const ref of refs) {
        const result = commitRes.getResult(ref);
        if (result?.id) {
          createdIds.push(result.id);
        } else if (result?.errors?.length) {
          console.warn('Create error for a single record after successful commit:', result.errors);
        }
      }
      console.log(`Successfully created ${createdIds.length} quote lines.`);

});








function getAdjustedStartDate(dateStr) {
  const date = new Date(dateStr);
  date.setDate(date.getDate() + 1);
  return date;
}

app.listen(PORT, () => {
    console.log(`Listening on ${ PORT }`)
})
