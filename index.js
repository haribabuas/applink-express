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

app.post('/create-quote-lines-sap', async (request, res) => {
    const { quoteId, sapLineIds } = request.body;
    console.log('Incoming request body:', request.body);
    console.log('@@@quoteId:', quoteId);
    console.log('@@@req.headers:', request.headers);
    request.sdk = applinkSDK.init();
    const routeOptions = request.routeOptions;
    const hasSalesforceConfig =
      routeOptions.config && routeOptions.config.salesforce;
    if (
      !(
        hasSalesforceConfig &&
        routeOptions.config.salesforce.parseRequest === false
      )
    ) {
      // Enrich request with hydrated SDK APIs
      const parsedRequest = request.sdk.salesforce.parseRequest(
        request.headers,
        request.body,
        request.log
      );
      request.sdk = Object.assign(request.sdk, parsedRequest);
    }
    console.log('@@@request.sdk ',request.sdk );
    const { event, context, logger } = request.sdk;
    const org = context.org
    
  const sf = applinkSDK.parseRequest(request.headers, request.body, null).context.org.dataApi;
    console.log('@@@sf',sf);
    const queryString = "SELECT Id, Name FROM Account LIMIT 10";
    const queryResult = await sf.query(queryString);
    const outAccounts = queryResult.records.map(rec => rec.fields);
    console.log('@@@outAccounts',outAccounts);

})

app.listen(PORT, () => {
    console.log(`Listening on ${ PORT }`)
})
