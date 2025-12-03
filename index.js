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

  // Safe nested getter: "A.B.C" → obj?.A?.B?.C
  const getByPath = (obj, path) => {
    if (!obj || !path) return undefined;
    return path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
  };

  // Date-only string in UTC
  const toDateOnly = (d) => {
    const date = new Date(d);
    if (Number.isNaN(date.getTime())) return null;
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  // If you need special logic for start date, adjust here
  const getAdjustedStartDate = (endDateStr) => {
    // Example: start = end - 12 months OR default to today
    const end = new Date(endDateStr);
    if (Number.isNaN(end.getTime())) return new Date(); // fallback: today
    const start = new Date(end);
    start.setMonth(start.getMonth() - 12);
    return start;
  };

  // ---------- Main ----------
  try {
    // Build SOQL safely
    const idsString = sapLineIds.map(id => `'${String(id).replace(/'/g, "\\'")}'`).join(',');

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
  const startDate = f.end_date_consolidated__c
    ? getAdjustedStartDate(f.end_date_consolidated__c)
    : new Date();
  const endDate = new Date(startDate);
  endDate.setMonth(endDate.getMonth() + 12);

  return {
    SBQQ__Quote__c: quoteId,
    SBQQ__Product__c: f.cpq_product__c,
    Install__c: f.install__c,
    Access_Range__c: f.cpq_product__r?.fields?.access_range__c, // safe nested access
    Account__c: f.install__r?.fields?.accountid__c,
    Partner_Account__c: f.install__r?.fields?.partner_account__c,
    Sales_Org__c: f.install__r?.fields?.cpq_sales_org__c,
    SBQQ__Quantity__c: f.quantity__c,
    SBQQ__StartDate__c: startDate.toISOString().split('T')[0],
    SBQQ__EndDate__c: endDate.toISOString().split('T')[0],
    CPQ_License_Type__c: f.license_type__c || 'MAINT'
  };
});


console.log('@@@quoteLinesToInsert',quoteLinesToInsert);
    // Batch via UnitOfWork: commit in chunks to avoid oversized transactions
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

      // Collect IDs from commit results
      for (const ref of refs) {
        const result = commitRes.getResult(ref);
        // Some SDKs return { id, success, errors }
        if (result?.id) {
          createdIds.push(result.id);
        } else if (result?.errors?.length) {
          console.warn('Create error:', result.errors);
        }
      }
    }

    return res.json({
      message: 'Quote lines created in UnitOfWork batches',
      createdCount: createdIds.length
    });

  } catch (err) {
    console.error('@@Error creating quote lines:', err);
    return res.status(500).json({ error: err.message });
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
