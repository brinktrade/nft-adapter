const assets = (gemApi) => async (params = {}) => {
  const defaultFields = [
    'id',
    'address',
    'market',
    'currentBasePrice',
    'currentEthPrice',
    'currentUsdPrice',
    'paymentToken',
    'tokenId'
  ]

  let data = {
    fields: {},
    filters: {}
  }

  if (params.address) {
    data.filters.address = params.address
  }

  if (params.sort) {
    data.sort = params.sort
  }

  const fields = params.fields || defaultFields
  fields.forEach(f => { data.fields[f] = 1 })

  const ret = await gemApi.post('/assets', data)
  return ret.data
}

module.exports = assets
