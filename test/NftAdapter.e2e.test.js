const initGem = require('../src/gem')
const axios = require('axios')
const { ethers } = require('hardhat')
const { expect } = require('chai')
const { setupProxyAccount } = require('@brinkninja/core/test/helpers')
const brinkUtils = require('@brinkninja/utils')
const { encodeFunctionCall } = brinkUtils
const brink = require('@brinkninja/sdk')
const deployContract = require('./helpers/deployContract')

const BN = ethers.BigNumber.from

const { GEM_API_URL, GEM_API_KEY } = process.env
const gem = initGem({
  url: GEM_API_URL,
  key: GEM_API_KEY
})

const ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const CUTE_EXPLODIES_NFT = '0x7ab2352b1d2e185560494d5e577f9d3c238b78c5'
const WHALE = '0xe78388b4ce79068e89bf8aa7f218ef6b9ab0e9d0'
const ADAPTER_OWNER = '0x71795b2d53Ffbe5b1805FE725538E4f8fBD29e26'

const TOKEN_TO_NFT_VERIFIER_PARAM_TYPES = [
  { name: 'bitmapIndex', type: 'uint256' },
  { name: 'bit', type: 'uint256' },
  { name: 'tokenIn', type: 'address' },
  { name: 'nftOut', type: 'address' },
  { name: 'tokenInAmount', type: 'uint256' },
  { name: 'expiryBlock', type: 'uint256' },
  { name: 'to', type: 'address' },
  { name: 'data', type: 'bytes' }
]

// End to end tx execution from Brink account with signed message, to execution via Gem API routing data.
// *** These depend on the live Gem API. If it's broken, these tests will break! ****
describe.skip('NftAdapter e2e tests with gem API / uni router API dependencies', function () {

  beforeEach(async function () {
    this.latestBlock = BN(await ethers.provider.getBlockNumber())
    this.expiryBlock = this.latestBlock.add(BN(1000)) // 1,000 blocks from now

    this.defaultSigner = (await ethers.getSigners())[0]

    const { proxyAccount, proxyOwner } = await setupProxyAccount()
    this.proxyAccount = proxyAccount
    this.proxyOwner = proxyOwner

    this.brinkSigner = brink.accountSigner(this.proxyOwner, 'mainnet')
    this.brinkAccountForExecutor = brink.account(this.proxyOwner.address, {
      provider: ethers.provider,
      signer: this.defaultSigner
    })

    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [WHALE],
    })
    this.whale = await hre.ethers.getSigner(WHALE)

    this.weth = await ethers.getContractAt('IWETH', WETH)
    this.usdc = await ethers.getContractAt('IERC20', USDC)
    this.cuteExplodies = await ethers.getContractAt('ERC721', CUTE_EXPLODIES_NFT)

    this.nftAdapter = await deployContract('NftAdapter')
    if (!await this.nftAdapter.initialized()) {
      await this.nftAdapter.initialize(WETH)
    }

    this.nftLimitSwapVerifier = await deployContract('NftLimitSwapVerifier')
  })

  it('ETH to NFT', async function () {
    // get the NFT asset and route callData from gem.xyz
    const { asset, route } = await getGemAssetAndRoute(this.nftAdapter.address, [1, 3, 5, 7])
  
    // test to ensure proxy account doesn't already own the NFT
    expect(await this.cuteExplodies.ownerOf(asset.id)).not.to.equal(this.proxyAccount.address)

    // value is the amount the NFT costs, paidAmount is the amount the Brink proxy account will pay
    const valueBN = BN(route.value)
    const arbAmount = ethers.utils.parseEther('0.02')
    const paidAmount = valueBN.add(arbAmount)

    // initial adapter owner balance, this address will receive the `arbAmount`
    const iAdapterOwnerBal = await ethers.provider.getBalance(ADAPTER_OWNER)

    // fund the brink account with the ETH it needs to buy the NFT
    await this.whale.sendTransaction({ to: this.proxyAccount.address, value: paidAmount })

    // Brink account owner signs a tokenToNft message to buy any cuteExplodies for `paidAmount`
    const signedTokenToNftMsg = await this.brinkSigner.signMetaDelegateCall(
      this.nftLimitSwapVerifier.address,
      {
        functionName: 'tokenToNft',
        paramTypes: TOKEN_TO_NFT_VERIFIER_PARAM_TYPES,
        params: [
          '0', '1', ETH_ADDRESS, this.cuteExplodies.address, paidAmount.toString(), this.expiryBlock.toString()
        ]
      }
    )

    // executor submits a tx with the signed message, and the adapter callData to source the NFT from gem.xyz provided route
    const adapterCallData = encodeFunctionCall(
      'buyWithEth',
      ['address', 'bytes', 'uint256', 'address', 'uint256', 'address'],
      [route.contractAddress, route.transaction, valueBN, asset.address, asset.id, this.proxyAccount.address]
    )
    await this.brinkAccountForExecutor.sendLimitSwap(
      signedTokenToNftMsg, this.nftAdapter.address, adapterCallData
    )

    // proxy account should now own the NFT
    expect(await this.cuteExplodies.ownerOf(asset.id)).to.equal(this.proxyAccount.address)

    // ADAPTER_OWNER should receive the arbAmount 0.02 ETH
    const fAdapterOwnerBal = await ethers.provider.getBalance(ADAPTER_OWNER)
    expect(fAdapterOwnerBal.sub(iAdapterOwnerBal)).to.be.at.least(arbAmount)
  })

  it('WETH to NFT', async function () {
    // get the NFT asset and route callData from gem.xyz
    const { asset, route } = await getGemAssetAndRoute(this.nftAdapter.address, [11, 13, 15, 17])

    // test to ensure proxy account doesn't already own the NFT
    expect(await this.cuteExplodies.ownerOf(asset.id)).not.to.equal(this.proxyAccount.address)

    // value is the amount the NFT costs, paidAmount is the amount the Brink proxy account will pay
    const valueBN = BN(route.value)
    const arbAmount = ethers.utils.parseEther('0.02')
    const paidAmount = valueBN.add(arbAmount)

    // initial adapter owner balance, this address will receive the `arbAmount`
    const iAdapterOwnerBal = await ethers.provider.getBalance(ADAPTER_OWNER)

    // fund the brink account with the WETH it needs to buy the NFT
    await this.weth.connect(this.whale).transfer(this.proxyAccount.address, paidAmount)

    // Brink account owner signs a tokenToNft message to buy any cuteExplodies for `paidAmount`
    const signedTokenToNftMsg = await this.brinkSigner.signMetaDelegateCall(
      this.nftLimitSwapVerifier.address,
      {
        functionName: 'tokenToNft',
        paramTypes: TOKEN_TO_NFT_VERIFIER_PARAM_TYPES,
        params: [
          '0', '1', WETH, this.cuteExplodies.address, paidAmount.toString(), this.expiryBlock.toString()
        ]
      }
    )

    // executor submits a tx with the signed message, and the adapter callData to source the NFT from gem.xyz provided route
    const adapterCallData = encodeFunctionCall(
      'buyWithWeth',
      ['address', 'bytes', 'uint256', 'address', 'uint256', 'address'],
      [route.contractAddress, route.transaction, valueBN, asset.address, asset.id, this.proxyAccount.address]
    )
    await this.brinkAccountForExecutor.sendLimitSwap(
      signedTokenToNftMsg, this.nftAdapter.address, adapterCallData
    )

    // proxy account should now own the NFT
    expect(await this.cuteExplodies.ownerOf(asset.id)).to.equal(this.proxyAccount.address)

    // ADAPTER_OWNER should receive the arbAmount 0.02 ETH
    const fAdapterOwnerBal = await ethers.provider.getBalance(ADAPTER_OWNER)
    expect(fAdapterOwnerBal.sub(iAdapterOwnerBal)).to.be.at.least(arbAmount)
  })

  it('token to NFT', async function () {
    // get the NFT asset and route callData from gem.xyz
    const { asset, route } = await getGemAssetAndRoute(this.nftAdapter.address, [2, 4, 6, 8])

    // test to ensure proxy account doesn't already own the NFT
    expect(await this.cuteExplodies.ownerOf(asset.id)).not.to.equal(this.proxyAccount.address)

    // value is the amount the NFT costs in ETH
    const valueBN = BN(route.value)

    // user signed token input amount (10k USDC is much higher than the ETH value for this set, so arb will be high)
    const usdcAmount = BN(10000).mul(BN(10).pow(BN(6)))

    // initial adapter owner balance, this address will receive the `arbAmount`
    const iAdapterOwnerBal = await ethers.provider.getBalance(ADAPTER_OWNER)

    // fund the brink account with the USDC it needs to buy the NFT
    await this.usdc.connect(this.whale).transfer(this.proxyAccount.address, usdcAmount)

    // Brink account owner signs a tokenToNft message to buy any cuteExplodies for `paidAmount`
    const signedTokenToNftMsg = await this.brinkSigner.signMetaDelegateCall(
      this.nftLimitSwapVerifier.address,
      {
        functionName: 'tokenToNft',
        paramTypes: TOKEN_TO_NFT_VERIFIER_PARAM_TYPES,
        params: [
          '0', '1', USDC, this.cuteExplodies.address, usdcAmount.toString(), this.expiryBlock.toString()
        ]
      }
    )

    // executor submits a tx with the signed message, and the adapter callData to source the NFT from gem.xyz provided route,
    // and calldata for USDC -> WETH swap
    const swapResp = await uniRouterCall(USDC, WETH, usdcAmount, this.nftAdapter.address)
    const swapCallData = swapResp.methodParameters.calldata
    const adapterCallData = encodeFunctionCall(
      'buyWithToken',
      ['address', 'bytes', 'address', 'bytes', 'uint256', 'address', 'uint256', 'address'],
      [USDC, swapCallData, route.contractAddress, route.transaction, valueBN.toString(), asset.address, asset.id, this.proxyAccount.address]
    )
    await this.brinkAccountForExecutor.sendLimitSwap(
      signedTokenToNftMsg, this.nftAdapter.address, adapterCallData
    )

    // proxy account should now own the NFT
    expect(await this.cuteExplodies.ownerOf(asset.id)).to.equal(this.proxyAccount.address)

    // ADAPTER_OWNER should receive some arb (amount will depend on current USDC/WETH market price)
    const fAdapterOwnerBal = await ethers.provider.getBalance(ADAPTER_OWNER)
    expect(fAdapterOwnerBal.sub(iAdapterOwnerBal) / 10**18).to.be.greaterThan(0)
  })
})

async function getGemAssetAndRoute (sender, assetIndeces) {
  const assets = (await gem.assets({
    address: CUTE_EXPLODIES_NFT,
    sort: { currentEthPrice: 'asc' }
  })).data
  
  let i = 0
  let route = {}, asset
  while(!route.transaction) {
    const assetIndex = assetIndeces[i]
    if (!assetIndex) {
      throw new Error(`All Gem API call routes returned empty tx data`)
    }

    asset = assets[assetIndex]

    route = (await gem.route({
      sender,
      address: CUTE_EXPLODIES_NFT,
      tokenId: asset.tokenId
    }))

    i++
  }

  return { asset, route }
}

async function sendGemRouteTx (sender, gemRoute) {
  const tx = await sender.sendTransaction({
    to: gemRoute.contractAddress,
    data: gemRoute.transaction,
    value: BN(gemRoute.value),
    gasLimit: 1_000_000
  })
  return tx
}

async function uniRouterCall (tokenInAddress, tokenOutAddress, amount, recipient) {
  const requestString = process.env.UNI_ROUTER_API + 'quote?' +
  'tokenInAddress=' + tokenInAddress + '&' +
  'tokenInChainId=1&' +
  'tokenOutAddress=' + tokenOutAddress + '&' +
  'tokenOutChainId=1&' +
  'amount=' + amount.toString() + '&' +
  'type=exactIn&' +
  'protocols=v2,v3&' +
  'recipient=' + recipient + '&' +
  'slippageTolerance=20&' +
  'deadline=10800'
  const resp = await axios.get(requestString)
  return resp.data
}
