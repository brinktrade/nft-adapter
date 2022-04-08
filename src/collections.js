const collections = (gemApi) => async (params = {}) => {

  let data = {}

  if (params.sort) {
    data.sort = {
      [`${params.sort}`]: params.sortDirection || -1
    }
  }

  if (params.fields) {
    data.fields = {}
    params.fields.forEach(f => { data.fields[f] = 1 })
  }

  if (params.filters) data.filters = params.filters
  if (params.limit) data.limit = params.limit
  if (params.offset) data.offset = params.offset
  if (params.markets) data.markets = params.markets
  if (params.status) data.status = params.status

  const ret = await gemApi.post('/collections', data)
  return ret.data
}

module.exports = collections
