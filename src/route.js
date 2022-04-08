const assets = (gemApi) => async (params = {}) => {
  if (!params.sender) throw new Error(`params.sender required`)
  if (!params.address) throw new Error(`params.address required`)
  if (!params.tokenId) throw new Error(`params.tokenId required`)

  let data = {
    sender: params.sender,
    balanceToken: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' || params.balanceToken,
    sell: [],
    buy: [
      {
        standard: 'ERC721' || params.standard,
        address: params.address,
        tokenId: params.tokenId,
        amount: 1
      }
    ]
  }

  const ret = await gemApi.post('/route', data)
  return ret.data
}

module.exports = assets
