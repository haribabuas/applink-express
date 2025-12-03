const PORT = process.env.APP_PORT || 3000
const applinkSDK = require('@heroku/applink')
const express = require('express')
const app = express()

app.use(express.json())

app.get('/accounts', async (request, res) => {
    console.log('@@@',request.body);
    console.log('@@@',request.headers);
    
    request.sdk = applinkSDK.init();
    console.log('@@@',request.sdk);
    
    const queryString = "SELECT Id, Name FROM Account LIMIT 10";

    const sf = applinkSDK.parseRequest(request.headers, request.body, null);//.context.org.dataApi;
    console.log('@@@sf',sf);
    

    const queryResult = await sf.query(queryString);
    const outAccounts = queryResult.records.map(rec => rec.fields);

    res.json(outAccounts);
})

app.listen(PORT, () => {
    console.log(`Listening on ${ PORT }`)
})
