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
    const sapRes = await org.dataApi.query(query);
    const sapLines = sapRes.records[0].fields;
  console.log('@@@sapLines',sapLines);
    const uow = org.dataApi.newUnitOfWork();
  const refId = uow.registerCreate('Account', {
      Name: 'Heroku Account'
    });

    console.log('@@@refid',refId);
    const commitResult = await org.dataApi.commitUnitOfWork(uow);
    console.log('@@@commitResult',commitResult);
   res.json({
      message: 'created '
    });

});

app.listen(PORT, () => {
    console.log(`Listening on ${ PORT }`)
})
