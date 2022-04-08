const snapshot = require('snap-shot-it')
const { expect } = require('chai')
const deployContract = require('./helpers/deployContract')
const { NFT_ADAPTER } = require('../constants')

describe('NftAdapter.sol', function () {
  it('deterministic address check', async function () {
    const nftAdapter = await deployContract('NftAdapter')
    const address = nftAdapter.address
    snapshot(address)
    expect(address, 'Deployed account address and NFT_ADAPTER constant are different').to.equal(NFT_ADAPTER)
  })
})