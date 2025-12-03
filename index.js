
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

  try {
    const sf = applinkSDK.parseRequest(req.headers, req.body, null);
    const org = sf.context.org;

    if (!org?.dataApi) {
      throw new Error('Salesforce org context not initialized. Check AppLink headers.');
    }

    // Test object accessibility
    const describe = await org.dataApi.describe('Account');
    console.log('@@@Describe Account:', describe);

    const uow = org.dataApi.newUnitOfWork();
    const refId = uow.registerCreate('Account', { Name: 'Heroku Account' });

    const commitResult = await org.dataApi.commitUnitOfWork(uow);
    const result = commitResult.getResult(refId);

    if (!result?.id) {
      throw new Error('Account creation failed');
    }

    res.json({
      message: 'Account created successfully',
      accountId: result.id
    });
  } catch (err) {
    console.error('@@Error:', err);
    res.status(500).json({
      error: err.message,
      details: err.response?.data || 'No additional details'
    });
  }
});

app.listen(PORT, () => {
  console.log(`Listening on ${PORT}`);
});
