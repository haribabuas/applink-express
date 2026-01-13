
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


const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function commitWithRetry(dataApi, uow, {
  maxRetries = 6,
  baseDelayMs = 250,
} = {}) {
  let attempt = 0;
  while (true) {
    try {
      return await dataApi.commitUnitOfWork(uow);
    } catch (e) {
      const msg = String(e?.message || e);
		console.log('@@@@',msg);
      const isLock = /UNABLE_TO_LOCK_ROW/i.test(msg);
      if (!isLock || attempt >= maxRetries) throw e;

      const delay = baseDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 200);
      attempt += 1;
      console.warn(`commitWithRetry: lock hit; retry ${attempt}/${maxRetries} after ${delay}ms`);
      await sleep(delay);
    }
  }
}

app.post('/api/generateOrderlines', async (req, res) => {
  try {
    const { orderId, quoteId } = req.body;
    const sf = applinkSDK.parseRequest(req.headers, req.body, null);
    const dataApi = sf.context.org?.dataApi;
    if (!dataApi) {
      return res.status(500).json({ error: 'Salesforce dataApi not available' });
    }
	const unitOfWork = dataApi.newUnitOfWork();
	  const fieldsToUpdate = {
		  id: quoteId, 
		  Name: 'Updated Account Name',
		  Phone: '1234567890'
		};
	  const accountRef = unitOfWork.registerUpdate({
      type: 'Account',
      fieldsToUpdate
    });
	  console.log('@@@accountRef',accountRef);
	const resultss = await dataApi.commitUnitOfWork(unitOfWork);

    const accountResult = resultss.get(accountRef);
    console.log('Account updated successfully with ID:', accountResult.id);
    // REMOVE FOR UPDATE: Data API doesn't support it
    // We still query Order so we can fail early if Id is bad
    const orderCheck = await dataApi.query(
      `SELECT Id FROM Order WHERE Id = '${orderId}' LIMIT 1`
    );
    if (!orderCheck?.records?.length) {
      return res.status(400).json({ error: 'Order not found', orderId });
    }

    const safeQuoteId = String(quoteId).replace(/'/g, "\\'");
	const safeOrderId = String(orderId).replace(/'/g, "\\'")
    // REMOVE FOR UPDATE here as well
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
        Install__c,
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
    console.log('@@@quoteLines ', quoteLines.length);
    if (!quoteLines.length) {
      return res.status(404).json({
        message: 'No quote lines found for the given quoteId',
        quoteId
      });
    }

    const buildOrderItemFields = (line) => {
      const rec = line?.fields;
      const productId = rec.SBQQ__Product__c;
      return {
        OrderId: orderId,
        Product2Id: productId,
        Description: 'Bridge',
        PricebookEntryId: rec.SBQQ__PricebookEntryId__c,

        Quantity: rec.SBQQ__Quantity__c,
        SBQQ__OrderedQuantity__c: rec.SBQQ__Quantity__c,
        SBQQ__QuotedQuantity__c: rec.SBQQ__Quantity__c,
        UnitPrice: (rec?.SBQQ__NetPrice__c ?? 0),

        SBQQ__BillingFrequency__c: rec.SBQQ__BillingFrequency__c,
        SBQQ__BillingType__c: rec.SBQQ__BillingType__c,
        SBQQ__BlockPrice__c: rec.SBQQ__BlockPrice__c,
        SBQQ__ChargeType__c: rec.SBQQ__ChargeType__c,
        SBQQ__DefaultSubscriptionTerm__c: rec.SBQQ__DefaultSubscriptionTerm__c,
        SBQQ__DiscountSchedule__c: rec.SBQQ__DiscountSchedule__c,
        SBQQ__PricingMethod__c: rec.SBQQ__PricingMethod__c,
        SBQQ__ProrateMultiplier__c: rec.SBQQ__ProrateMultiplier__c,
        SBQQ__RequiredBy__c: rec.SBQQ__RequiredBy__c,
        SBQQ__SegmentIndex__c: rec.SBQQ__SegmentIndex__c,
        SBQQ__SegmentKey__c: rec.SBQQ__SegmentKey__c,
        SBQQ__TaxCode__c: rec.SBQQ__TaxCode__c,
        SBQQ__TermDiscountSchedule__c: rec.SBQQ__TermDiscountSchedule__c,
        SBQQ__UnproratedNetPrice__c: rec.SBQQ__UnproratedNetPrice__c,
        SBQQ__UpgradedSubscription__c: rec.SBQQ__UpgradedSubscription__c,

        ServiceDate: rec.SBQQ__EffectiveStartDate__c,
        EndDate: rec.SBQQ__EffectiveEndDate__c,
        Install__c: rec.Install__c,
        SBQQ__QuoteLine__c: rec.Id,
      };
    };

    // Smaller batches reduce lock durations
    const BATCH_SIZE = 500;

    // Deterministic ordering to reduce deadlocks
    quoteLines.sort((a, b) => {
      const pa = a?.fields?.SBQQ__PricebookEntryId__c || '';
      const pb = b?.fields?.SBQQ__PricebookEntryId__c || '';
      if (pa === pb) {
        const ia = a?.fields?.Id || '';
        const ib = b?.fields?.Id || '';
        return ia.localeCompare(ib);
      }
      return pa.localeCompare(pb);
    });

    const resultsPerBatch = [];
    let createdCount = 0;

    for (let i = 0; i < quoteLines.length; i += BATCH_SIZE) {
      const batch = quoteLines.slice(i, i + BATCH_SIZE);

      const uow = dataApi.newUnitOfWork();
      const refs = [];
      for (const line of batch) {
        const fields = buildOrderItemFields(line);
        const ref = uow.registerCreate({ type: 'OrderItem', fields });
        refs.push(ref);
      }

      console.log('@@@uow batch', Math.floor(i / BATCH_SIZE));

      // Commit with robust retry on row locks
      const resMap = await commitWithRetry(dataApi, uow);

      const createdIds = refs
        .map(r => resMap.get(r)?.id)
        .filter(Boolean);

      resultsPerBatch.push({
        batchIndex: Math.floor(i / BATCH_SIZE),
        count: createdIds.length,
        ids: createdIds
      });
      createdCount += createdIds.length;
    }

	  
	const statusUow = dataApi.newUnitOfWork();
	const updRef = statusUow.registerUpdate({
	    type: 'Order',
	    fields: { Status: 'Draft' },
		id: safeOrderId 
	  });
	console.log('@@@updRef',updRef);
     const results = await dataApi.commitUnitOfWork(statusUow);

    return res.status(200).json({
      message: 'Quote lines converted to order items',
      quoteId,
      orderId,
      createdCount,
      results: resultsPerBatch
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
