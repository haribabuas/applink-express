const PORT = process.env.APP_PORT || 3000
const applinkSDK = require('@heroku/applink')
const express = require('express')
const app = express()

app.use(express.json())

app.get('/accounts', async (req, res) => {
    console.log('@@@',req.body);
    console.log('@@@',req.headers);
    
    req.sdk = applinkSDK.init();
    const { event, context, logger } = req.sdk;
    const queryString = "SELECT Id, Name FROM Account LIMIT 10";
    const org = context.org;
    console.log('@@@org',org);
    const result = await org.dataApi.query(query);
    console.log('@@@result',result);
    const sf = applinkSDK.parseRequest(req.headers, req.body, null).context.org.dataApi;
    console.log('@@@sf',sf);
    

    const queryResult = await sf.query(queryString);
    const outAccounts = queryResult.records.map(rec => rec.fields);

    res.json(outAccounts);
})

app.listen(PORT, () => {
    console.log(`Listening on ${ PORT }`)
})
