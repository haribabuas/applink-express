
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


app.post('/api/generateContractlines2', async (req, res, next) => {
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
});


app.post('/api/generateContractlines', async (req, res) => {
  try {
    const { orderIds } = req.body;
    const sf = applinkSDK.parseRequest(req.headers, req.body, null);
    const dataApi = sf.context.org?.dataApi;

    let ids = [];
    if (Array.isArray(orderIds)) {
      ids = orderIds;
    } else if (typeof orderIds === 'string') {
      ids = orderIds.split(',').map(s => s.trim()).filter(Boolean);
    }
    ids = Array.from(new Set(ids));
    const escape = (s) => String(s).replace(/'/g, "\\'");
    const inList = ids.map(id => `'${escape(id)}'`).join(', ');

    const soql = `
      SELECT
        Order.AccountId, Order.ContractId,
        Id, OrderId, Product2Id, Description, PricebookEntryId, Quantity,
        SBQQ__OrderedQuantity__c, SBQQ__QuotedQuantity__c, UnitPrice,
        SBQQ__BillingFrequency__c, SBQQ__BillingType__c, SBQQ__BlockPrice__c,
        SBQQ__ChargeType__c, SBQQ__DefaultSubscriptionTerm__c, SBQQ__DiscountSchedule__c,
        SBQQ__PricingMethod__c, SBQQ__ProrateMultiplier__c, SBQQ__RequiredBy__c,
        SBQQ__SegmentIndex__c, SBQQ__SegmentKey__c, SBQQ__TaxCode__c,
        SBQQ__TermDiscountSchedule__c, SBQQ__UnproratedNetPrice__c, SBQQ__UpgradedSubscription__c,
        ServiceDate, SBQQ__QuoteLine__c, EndDate
      FROM OrderItem
      WHERE OrderId IN (${inList})
    `;

    const qResult = await dataApi.query(soql);
    
    const orderLines = Array.isArray(qResult?.records) ? qResult.records : [];
    console.log('@@@orderLines', orderLines.length);

    const soqlCont = `
      SELECT
        Id
      FROM Contract
      WHERE SBQQ__Order__c IN (${inList})
    `;

    const cResult = await dataApi.query(soqlCont);
    console.log('rest@@@',cResult);
    let contractId = null;
    console.log('id@@@',cResult.records[0].Id);
    if (cResult.records && cResult.records.length >= 0) {
      contractId = cResult.records[0].Id;
    }
    console.log('***@@@',contractId);
    const buildOrderItemFields = (line) => {
      const item = line?.fields;
      const productId = item.SBQQ__Product__c;
      return {
        SBQQ__Contract__c:             contractId,
        SBQQ__Product__c:              item?.Product2Id ?? null,
        SBQQ__Quantity__c:             item?.Quantity ?? 0,
        SBQQ__SubscriptionStartDate__c:item?.ServiceDate ?? null,
        SBQQ__SubscriptionEndDate__c:  item?.EndDate ?? null,
        SBQQ__Account__c:              item?.Order?.fields?.AccountId ?? null,
        SBQQ__NetPrice__c:             (item?.UnitPrice ?? 0),
        SBQQ__BillingFrequency__c:     item?.SBQQ__BillingFrequency__c ?? null,
        SBQQ__BillingType__c:          item?.SBQQ__BillingType__c ?? null,
        SBQQ__ChargeType__c:           item?.SBQQ__ChargeType__c ?? null,
        SBQQ__DiscountSchedule__c:     item?.SBQQ__DiscountSchedule__c ?? null,
        SBQQ__SegmentIndex__c:         item?.SBQQ__SegmentIndex__c ?? null,
        SBQQ__SegmentKey__c:           item?.SBQQ__SegmentKey__c ?? null,
        SBQQ__TermDiscountSchedule__c: item?.SBQQ__TermDiscountSchedule__c ?? null,
        SBQQ__PricingMethod__c:        item?.SBQQ__PricingMethod__c ?? null,

        SBQQ__OrderProduct__c:         item?.Id ?? null,
        SBQQ__QuoteLine__c:            item?.SBQQ__QuoteLine__c ?? null,
      };
    };

    // ------------------------------
    // NEW: commit inserts in batches of 200
    // ------------------------------
    const BATCH_SIZE = 200;
    const resultsPerBatch = [];
    let createdCount = 0;

    for (let i = 0; i < orderLines.length; i += BATCH_SIZE) {
      const batch = orderLines.slice(i, i + BATCH_SIZE);

  
      const uow = dataApi.newUnitOfWork();

    
      const refs = [];
      for (const line of batch) {
        const fields = buildOrderItemFields(line);
        const ref = uow.registerCreate({
          type: 'SBQQ__Subscription__c',
          fields
        });
        refs.push(ref);
      }

      console.log('@@@uow batch', Math.floor(i / BATCH_SIZE));
      const resMap = await dataApi.commitUnitOfWork(uow);

      const createdIds = refs.map(r => resMap.get(r)?.id).filter(Boolean);
      resultsPerBatch.push({
        batchIndex: Math.floor(i / BATCH_SIZE),
        count: createdIds.length,
        ids: createdIds
      });

      createdCount += batch.length;
    }

    return res.status(200).json({
      message: 'Subscrptions lines are created',
      orderIds,
      createdCount,
      results: resultsPerBatch
    });

  } catch (err) {
    console.error('generateContractlines failed', err);
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
