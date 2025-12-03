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

app.post('/create-quote-lines-sap', async (req, res) => {
    const { quoteId, sapLineIds } = req.body;
  console.log('Incoming request body:', req.body);
    console.log('@@@quoteId:', quoteId);
  const sf = applinkSDK.parseRequest(req.headers, req.body, null).context.org.dataApi;

    const queryString = "SELECT Id, Name FROM Account LIMIT 10";
    const queryResult = await sf.query(queryString);
    const outAccounts = queryResult.records.map(rec => rec.fields);
    console.log('@@@outAccounts',outAccounts);

})

app.listen(PORT, () => {
    console.log(`Listening on ${ PORT }`)
})
