
const PORT = process.env.APP_PORT || 3000;
const applinkSDK = require('@heroku/applink');
const express = require('express');
const app = express();
app.use(express.json());


function chunkArray(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}



//const crypto = require('crypto');


/*app.post('/api/generateOrderlines', async (req, res, next) => {
  try {
    const { orderId, quoteId } = req.body;
    
    console.log('@@@',quoteId);
    const sf = applinkSDK.parseRequest(req.headers, req.body, null);
    const dataApi = sf.context.org.dataApi;
    console.log('@@@dataApi',dataApi);
    return res.status(200).json({ message: 'Quote lines created'});
  } catch (err) {
    console.error('generatequotelines failed', err);
    return res.status(500).json({ error: 'Internal error', details: String(err?.message || err) });
  }
});*/



app.post('/api/generateOrderlines', async (req, res) => {
  try {
    const { orderId, quoteId } = req.body;

    if (!orderId || !quoteId) {
      return res.status(400).json({
        error: 'Missing required input',
        details: 'Please provide both orderId and quoteId in the request body.'
      });
    }

    const sf = applinkSDK.parseRequest(req.headers, req.body, null);
    const dataApi = sf.context.org?.dataApi;
    if (!dataApi) {
      return res.status(500).json({
        error: 'Salesforce dataApi unavailable',
        details: 'Ensure applinkSDK.parseRequest provides sf.context.org.dataApi'
      });
    }

    const safeQuoteId = String(quoteId).replace(/'/g, "\\'");

    const soql = `
      SELECT
        Id,
        SBQQ__Product__c,
        SBQQ__PricebookEntryId__c,
        SBQQ__Quantity__c,
        SBQQ__BillingFrequency__c,
        SBQQ__BillingType__c,
        SBQQ__BlockPrice__c,
        SBQQ__ChargeType__c,
        SBQQ__DefaultSubscriptionTerm__c,
        SBQQ__DiscountSchedule__c,
        SBQQ__PricingMethod__c,
        SBQQ__ProrateMultiplier__c,
        SBQQ__RequiredBy__c,
        SBQQ__SegmentIndex__c,
        SBQQ__SegmentKey__c,
        SBQQ__SubscriptionTerm__c,
        SBQQ__SubscriptionType__c,
        SBQQ__TaxCode__c,
        SBQQ__TermDiscountSchedule__c,
        SBQQ__UnproratedNetPrice__c,
        SBQQ__UpgradedSubscription__c,
        SBQQ__EffectiveStartDate__c,
        SBQQ__EffectiveEndDate__c,
        SBQQ__NetPrice__c
      FROM SBQQ__QuoteLine__c
      WHERE SBQQ__Quote__c = '${safeQuoteId}'
    `;

    const qResult = await dataApi.query(soql);
    const quoteLines = Array.isArray(qResult?.records) ? qResult.records : [];
    console.log('@@@quoteLines',quoteLines);
    if (!quoteLines.length) {
      return res.status(404).json({
        message: 'No quote lines found for the given quoteId',
        quoteId
      });
    }

    // Helper to read values from dataApi query result (records[].fields[api].value)
    const fv = (record, fieldApiName) => record?.fields?.[fieldApiName]?.value;

    // Build fields for OrderItem as per Apex mapping
    const buildOrderItemFields = (line) => {
      const qty = fv(line, 'SBQQ__Quantity__c');
      const netPrice = fv(line, 'SBQQ__NetPrice__c');
      const effStart = fv(line, 'SBQQ__EffectiveStartDate__c'); // usually ISO string
      const effEnd = fv(line, 'SBQQ__EffectiveEndDate__c');

      return {
        OrderId: orderId,
        Product2Id: fv(line, 'SBQQ__Product__c'),
        Description: 'Bridge',
        PricebookEntryId: fv(line, 'SBQQ__PricebookEntryId__c'),

        Quantity: qty != null ? Number(qty) : undefined,
        SBQQ__OrderedQuantity__c: qty != null ? Number(qty) : undefined,
        SBQQ__QuotedQuantity__c: qty != null ? Number(qty) : undefined,
        UnitPrice: netPrice != null ? Number(netPrice) : undefined,

        SBQQ__BillingFrequency__c: fv(line, 'SBQQ__BillingFrequency__c'),
        SBQQ__BillingType__c: fv(line, 'SBQQ__BillingType__c'),
        SBQQ__BlockPrice__c: fv(line, 'SBQQ__BlockPrice__c'),
        SBQQ__ChargeType__c: fv(line, 'SBQQ__ChargeType__c'),
        SBQQ__DefaultSubscriptionTerm__c: fv(line, 'SBQQ__DefaultSubscriptionTerm__c'),
        SBQQ__DiscountSchedule__c: fv(line, 'SBQQ__DiscountSchedule__c'),
        SBQQ__PricingMethod__c: fv(line, 'SBQQ__PricingMethod__c'),
        SBQQ__ProrateMultiplier__c: fv(line, 'SBQQ__ProrateMultiplier__c'),
        SBQQ__RequiredBy__c: fv(line, 'SBQQ__RequiredBy__c'),
        SBQQ__SegmentIndex__c: fv(line, 'SBQQ__SegmentIndex__c'),
        SBQQ__SegmentKey__c: fv(line, 'SBQQ__SegmentKey__c'),
        SBQQ__TaxCode__c: fv(line, 'SBQQ__TaxCode__c'),
        SBQQ__TermDiscountSchedule__c: fv(line, 'SBQQ__TermDiscountSchedule__c'),
        SBQQ__UnproratedNetPrice__c: fv(line, 'SBQQ__UnproratedNetPrice__c'),
        SBQQ__UpgradedSubscription__c: fv(line, 'SBQQ__UpgradedSubscription__c'),

        ServiceDate: effStart || undefined, // ISO string OK
        EndDate: effEnd || undefined,

        SBQQ__QuoteLine__c: fv(line, 'Id'),
      };
    };

    let results;
    let createdCount;

    if (typeof dataApi.newUnitOfWork === 'function' && typeof dataApi.commitUnitOfWork === 'function') {
      const uow = dataApi.newUnitOfWork();

      for (const line of quoteLines) {
        const fields = buildOrderItemFields(line);

        // Use the object-style signature you requested
        uow.registerCreate({
          type: 'OrderItem',
          fields
        });
      }
      console.log('@@@uow',uow);
      results = await dataApi.commitUnitOfWork(uow);
      createdCount = quoteLines.length;

    } else {
      // Fallback to per-record create (non-transactional)
      results = [];
      for (const line of quoteLines) {
        const fields = buildOrderItemFields(line);
        const r = await dataApi.createRecord('OrderItem', fields);
        results.push(r);
      }
      createdCount = results.length;
    }

    return res.status(200).json({
      message: 'Quote lines converted to order items',
      quoteId,
      orderId,
      createdCount,
      results
    });

  } catch (err) {
    console.error('generateOrderlines failed', err);
    return res.status(500).json({
      error: 'Internal error',
      details: String(err?.message || err)
    });
  }
});


    

async function logFailedBatchAsJson({dataApi, quoteId, failedRecords, err}) {
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
