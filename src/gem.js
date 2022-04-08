const axios = require('axios')
const collections = require('./collections')
const assets = require('./assets')
const route = require('./route')

module.exports = (opts) => {
  const gemApi = axios.create({
    baseURL: `${opts.url}`
  })
  gemApi.defaults.headers.common['X-API-KEY'] = opts.key

  return {
    collections: collections(gemApi),
    assets: assets(gemApi),
    route: route(gemApi)
  }
}
