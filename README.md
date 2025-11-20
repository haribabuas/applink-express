# JJ AppLink Express Accounts

Simple Express app to query Salesforce using AppLink SDK<br/>
<br/>

Assumes you have a Salesforce org that is enabled for Heroku Applink that you can try sample code in.<br/>
<br/>

The key features to make this work with [AppLink Service Mesh](https://github.com/heroku/heroku-buildpack-heroku-applink-service-mesh) are:
* add the service mesh buildpack
* add Heroku config var APP_PORT
* adjust the Procfile to launch service mesh
* in code, bind Express to $APP_PORT
<br/>

## Read First

*DISCLAIMER* -- This is a demo, not production code. Feel free to consult the code and use it to fuel your own ideas, but please do not assume it's ready to plug into a production environment as-is.<BR>
<br/>

---

## Setup

```
heroku create jj-applink-express-accounts
```

```
heroku buildpacks:add heroku/heroku-applink-service-mesh
```

```
heroku buildpacks:add heroku/nodejs
```

```
heroku addons:create heroku-applink
```

```
heroku config:set APP_PORT=3000
```

```
git push heroku main
```

(Set permset for Manage Applink)

```
heroku salesforce:connect MyOrg
```

```
heroku salesforce:publish api-spec.yaml --client-name=HerokuAPI --authorization-connected-app-name=ApplinkAccountsAccessConnectedApp --connection-name=MyOrg
```

(Set HerokuAPI permset)<br/>
<br/>

## Testing

Run this anonymous Apex:
```
herokuapplink.HerokuAPI herokuAPI = new herokuapplink.HerokuAPI();
herokuapplink.HerokuAPI.GetAccounts_Response response = herokuAPI.GetAccounts();
System.debug(JSON.serializePretty(response));
```
<br/>

## Cleanup

Delete the Heroku app in the web dashboard or use this command:

```
heroku destroy
```

Delete the External Service "HerokuAPI" from your Salesforce Org as explained in [these instructions](https://devcenter.heroku.com/articles/getting-started-heroku-applink#delete-your-connections-published-apps-and-add-on).