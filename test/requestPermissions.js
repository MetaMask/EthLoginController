const test = require('tape')
const LoginController = require('../')
const equal = require('fast-deep-equal')

// TODO: Standardize!
// Maybe submit to https://github.com/ethereum/wiki/wiki/JSON-RPC-Error-Codes-Improvement-Proposal
const USER_REJECTION_CODE = 5

test('requestPermissions with user rejection creates no permissions', async (t) => {
  const expected = {}

  const ctrl = new LoginController({
    requestUserApproval: () => Promise.resolve(false),
  })

  const domain = 'login.metamask.io'
  let req = {
    method: 'requestPermissions',
    params: [
      {
        'restricted': {},
      }
    ]
  }
  let res = {}

  ctrl.providerMiddlewareFunction(domain, req, res, next, end)

  function next() {
    t.ok(false, 'next should not be called')
    t.end()
  }

  function end(reason) {
    t.ok(reason, 'error thrown')
    console.dir(reason)
    t.equal(reason.code, 5, 'Rejection error returned')
    t.ok(equal(ctrl._getPermissions(domain), expected), 'should have no permissions still')
    t.end()
  }
})

test('requestPermissions with user approval creates permission', async (t) => {
  const expected = {
     domains: {
      'login.metamask.io': {
        permissions: {
          'restricted': {
            date: '0',
          }
        }
      }
    }
  }


  const ctrl = new LoginController({
    requestUserApproval: () => Promise.resolve(true),
  })

  const domain = 'login.metamask.io'
  let req = {
    method: 'requestPermissions',
    params: [
      {
        'restricted': {},
      }
    ]
  }
  let res = {}

  ctrl.providerMiddlewareFunction(domain, req, res, next, end)

  function next() {
    t.ok(false, 'next should not be called')
    t.end()
  }

  function end(reason) {
    t.error(reason, 'error should not be thrown')
    t.error(res.error, 'error should not be thrown')
    const endState = ctrl.store.getState()
    t.ok(equal(endState.domains[domain].permissions, req.params[0]), 'should have the requested permissions')
    t.end()
  }
})


