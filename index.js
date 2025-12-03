
const PORT = process.env.APP_PORT || 3000;
const applinkSDK = require('@heroku/applink');
const express = require('express');
const app = express();
app.use(express.json());


app.post('/api/generatequotelines', async (req, res) => {
  const { quoteId, sapLineIds } = req.body;

  if (!quoteId || !sapLineIds?.length) {
    return res.status(400).json({ error: 'Missing required data' });
  }

    const sf = applinkSDK.parseRequest(req.headers, req.body, null);
    const org = sf.context.org;

    console.log('@@@Org Context:', org);

    const uow = org.dataApi.newUnitOfWork();
    const refId = uow.registerCreate('Account', { Name: 'Heroku Account' });

    const commitResult = await org.dataApi.commitUnitOfWork(uow);
    const result = commitResult.getResult(refId);
console.log('@@@Org result:', result);
    res.json({
      message: 'Account created successfully'
    });
 
});


app.listen(PORT, () => {
  console.log(`Listening on ${PORT}`);
});
