
app.post('/api/generatequotelines', async (req, res) => {
  const { quoteId, sapLineIds } = req.body;

  if (!quoteId || !sapLineIds?.length) {
    return res.status(400).json({ error: 'Missing required data' });
  }

  try {
    const sf = applinkSDK.parseRequest(req.headers, req.body, null);
    const org = sf.context.org;

    if (!org?.dataApi) {
      throw new Error('Salesforce context not initialized. Check AppLink headers.');
    }

    console.log('@@@Org Context:', org);

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
