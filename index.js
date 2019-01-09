const ObservableStore = require('obs-store')
const equal = require('fast-deep-equal')

const UNAUTHORIZED_ERROR = {
  message: 'Unauthorized to perform action',
  code: 1,
}
const METHOD_NOT_FOUND = {
  code: -32601,
  messages: 'Method not found',
}

class JsonRpcCapabilities {

  constructor({ safeMethods = [], restrictedMethods = {}, initState = {}, methods = {}, methodPrefix = '', requestUserApproval}) {
    this.safeMethods = safeMethods
    this.restrictedMethods = restrictedMethods
    this.methods = methods
    this.requestUserApproval = requestUserApproval

    this.internalMethods = {}
    this.internalMethods[`${methodPrefix}getPermissions`] = this.getPermissionsMiddleware.bind(this)
    this.internalMethods[`${methodPrefix}requestPermissions`] = this.requestPermissionsMiddleware.bind(this)
    this.internalMethods[`${methodPrefix}grantPermissions`] = this.grantPermissionsMiddleware.bind(this)
    this.internalMethods[`${methodPrefix}revokePermissions`] = this.revokePermissionsMiddleware.bind(this)
    // TODO: Freeze internal methods object.

    this.store = new ObservableStore(initState || {})
    this.memStore = new ObservableStore({
      permissionsRequests: [],
    })
  }

  serialize () {
    return this.store.getState()
  }

  /*
   * Returns a nearly json-rpc-engine compatible method.
   * The one difference being the first argument should be
   * a unique string identifying the requesting agent/entity,
   * referred to as `domain` in the code. This allows the function to be curried and converted into a normal json-rpc-middleware function.
   *
   * @param {string} domain - A unique string representing the requesting entity.
   * @param {Object} req - The JSON-RPC compatible request object.
   * @param {string} req.method - The JSON RPC method being called.
   * @param {Object} res - The JSON RPC compatible response object.
   * @param {callback} next - A function to pass the responsibility of handling the request down the json-rpc-engine middleware stack.
   * @param {callback} end - A function to stop traversing the middleware stack, and reply immediately with the current `res`. Can be passed an Error object to return an error.
   */
  providerMiddlewareFunction (domain, req, res, next, end) {
    const methodName = req.method

    // skip registered safe/passthrough methods.
    if (this.safeMethods.includes(methodName)) {
      return next()
    }

    // handle internal methods before any restricted methods.
    if (methodName in this.internalMethods) {
      return this.internalMethods[methodName](domain, req, res, next, end)
    }

    // Traverse any permission delegations
    let permission
    try {
      permission = this._getPermission(domain, methodName)
    } catch (err) {
      res.error = {
        message: err.message,
        code: 1,
      }
      return end(res.error)
    }

    if (!permission) {
      res.error = UNAUTHORIZED_ERROR
      return end(UNAUTHORIZED_ERROR)
    }

    this._executeMethod(req, res, next, end)
  }

  _executeMethod(req, res, next, end) {
    const methodName = req.method
    if (methodName in this.restrictedMethods
       && typeof this.restrictedMethods[methodName].method === 'function') {
      return this.restrictedMethods[methodName].method(req, res, next, end)
    }

    res.error = METHOD_NOT_FOUND
    return end(METHOD_NOT_FOUND)
  }

  _getPermissions (domain) {
    const { domains = {} } = this.store.getState()
    if (domain in domains) {
      const { permissions } = domains[domain]
      return permissions
    }
    return {}
  }

  _getPermission (domain, method) {
    const permissions = this._getPermissions(domain)
    if (method in permissions) {
      return permissions[method]
    }
    throw new Error('Domain unauthorized to use method ' + method)
  }

  get _permissionsRequests () {
    return this.memStore.getState().permissionsRequests
  }

  set _permissionsRequests (permissionsRequests) {
    this.memStore.putState({ permissionsRequests })
  }

  /*
   * Adds the request to the requestedPermissions array, for user approval.
   */
  _requestPermissions (req, res, next, end) {
    // TODO: Validate permissions request
    const requests = this._permissionsRequests
    requests.push(req)
    this._permissionsRequests = requests
    this.requestUserApproval(req, res, next, end)
    .then((approved) => {
      if (!approved) {
        res.error = UNAUTHORIZED_ERROR
        return end(UNAUTHORIZED_ERROR)
      }

      return this.grantNewPermissions(req.params[0])
    })
    .catch((reason) => {
      res.error = reason
      return end(reason)
    })
  }

  async grantNewPermissions (permissions) {
    // Remove any matching requests from the queue:
    this._permissionsRequests = this._permissionsRequests.filter((request) => {
      return equal(permissions, request)
    })

    // Update the related permission objects:
    let officialPerms = this._permissions
    officialPerms.forEach((permission) => {
      officialPerms[permission.method] = permission
    })
    this._permissions = officialPerms
  }

  set _permissions (permissions) {
    this.store.putState(permissions)
  }

  getPermissionsMiddleware (domain, req, res, next, end) {
    const permissions = this._getPermissions(domain)
    res.result = permissions
    end()
  }

  requestPermissionsMiddleware (domain, req, res, next, end) {
    const params = req.params
    this._requestPermissions(req, res, next, end)
    if (this.requestUserApproval) {
      this.requestUserApproval(params, end)
    } else {
      res.result = 'Request submitted.'
      end()
    }
  }

  grantPermissionsMiddleware (domain, req, res, next, end) {
    res.error = { message: 'Method not implemented' }
    end(res.error)
  }

  revokePermissionsMiddleware (domain, req, res, next, end) {
    res.error = { message: 'Method not implemented' }
    end(res.error)
  }
}

module.exports = JsonRpcCapabilities

