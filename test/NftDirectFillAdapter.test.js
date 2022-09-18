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

const ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const WHALE = '0xe78388b4ce79068e89bf8aa7f218ef6b9ab0e9d0'
const ADAPTER_OWNER = '0x71795b2d53Ffbe5b1805FE725538E4f8fBD29e26'

const TOKEN_TO_NFT_APPROVAL_VERIFIER_PARAM_TYPES = [
  { name: 'bitmapIndex', type: 'uint256' },
  { name: 'bit', type: 'uint256' },
  { name: 'tokenIn', type: 'address' },
  { name: 'nftOut', type: 'address' },
  { name: 'tokenInAmount', type: 'uint256' },
  { name: 'expiryBlock', type: 'uint256' },
  { name: 'recipient', type: 'address' },
  { name: 'to', type: 'address' },
  { name: 'data', type: 'bytes' }
]

describe('NftDirectFillAdapter', function () {
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

    this.nftAdapter = await deployContract('NftDirectFillAdapter')
    if (!await this.nftAdapter.initialized()) {
      await this.nftAdapter.initialize(WETH)
    }

    this.nftApprovalSwapVerifier = await deployContract('NftApprovalSwapVerifier')
    this.testFulfillSwap = await deployContract('TestFulfillSwap')

    const TestERC721 = await ethers.getContractFactory('TestERC721')
    this.testNft = await TestERC721.deploy('Test', 'TEST')

    this.testNftId = 12345
    await this.testNft.mint(this.testFulfillSwap.address, this.testNftId)
  })

  it('ETH to NFT', async function () {
    const ethAmountTotal = ethers.utils.parseEther('1.1')
    const nftCost = ethers.utils.parseEther('1.0')

    // transfer 1 ETH to account
    await this.whale.sendTransaction({
      to: this.proxyAccount.address,
      value: ethAmountTotal
    })

    // Brink account owner signs a tokenToNft message to buy any testNft for `paidAmount`
    const signedMsg = await this.brinkSigner.signMetaDelegateCall(
      this.nftApprovalSwapVerifier.address,
      {
        functionName: 'tokenToNft',
        paramTypes: TOKEN_TO_NFT_APPROVAL_VERIFIER_PARAM_TYPES,
        params: [
          '0', '1', ETH_ADDRESS, this.testNft.address, ethAmountTotal.toString(), this.expiryBlock.toString()
        ]
      }
    )

    // callData executer uses to source the swap
    const fulfillSwapCallData = encodeFunctionCall(
      'fulfillNftOutSwap',
      ['address', 'uint256', 'address'],
      [this.testNft.address, this.testNftId, this.nftAdapter.address]
    )
    const adapterCallData = encodeFunctionCall(
      'buyWithEth',
      ['address', 'bytes', 'uint256', 'address', 'uint256', 'address'],
      [this.testFulfillSwap.address, fulfillSwapCallData, nftCost, this.testNft.address, this.testNftId, this.proxyAccount.address]
    )

    // initial conditions: TestFulfillSwap contract has the NFT, proxy account has 1.1 ETH
    expect(await this.testNft.ownerOf(this.testNftId)).to.equal(this.testFulfillSwap.address)
    expect(await ethers.provider.getBalance(this.proxyAccount.address)).to.equal(ethAmountTotal)
    const iAdapterOwnerBalance = await ethers.provider.getBalance(ADAPTER_OWNER)
    const iTestFulfillSwapBalance = await ethers.provider.getBalance(this.testFulfillSwap.address)

    // executor submits a tx with the signed message, and callData to source the NFT from TestFulfillSwap
    await this.brinkAccountForExecutor.sendLimitSwap(
      signedMsg, this.nftAdapter.address, adapterCallData
    )

    // test final conditions: proxy account receives the NFT, TestFulfillSwap receives 1.0 ETH, ADAPTER_OWNER receives arb of 0.1 ETH
    expect(await this.testNft.ownerOf(this.testNftId)).to.equal(this.proxyAccount.address)
    const fAdapterOwnerBalance = await ethers.provider.getBalance(ADAPTER_OWNER)
    const fTestFulfillSwapBalance = await ethers.provider.getBalance(this.testFulfillSwap.address)
    expect(fTestFulfillSwapBalance.sub(iTestFulfillSwapBalance)).to.equal(nftCost)
    expect(fAdapterOwnerBalance.sub(iAdapterOwnerBalance)).to.equal(ethAmountTotal.sub(nftCost))
  })

  it.only('token to NFT', async function () {
    const usdcAmount = BN(100000).mul(BN(10).pow(BN(6))) // 100k USDC input
    const nftCost = ethers.utils.parseEther('1.0')

    // transfer 100k USDC to account
    await this.usdc.connect(this.whale).transfer(this.proxyAccount.address, usdcAmount)

    // Brink account owner signs a tokenToNft message to buy any testNft for `paidAmount`
    const signedMsg = await this.brinkSigner.signMetaDelegateCall(
      this.nftApprovalSwapVerifier.address,
      {
        functionName: 'tokenToNft',
        paramTypes: TOKEN_TO_NFT_APPROVAL_VERIFIER_PARAM_TYPES,
        params: [
          '0', '1', USDC, this.testNft.address, usdcAmount.toString(), this.expiryBlock.toString()
        ]
      }
    )

    // initial conditions: TestFulfillSwap contract has the NFT, proxy account has 1.1 ETH
    expect(await this.testNft.ownerOf(this.testNftId)).to.equal(this.testFulfillSwap.address)
    expect(await this.usdc.balanceOf(this.proxyAccount.address)).to.equal(usdcAmount)
    const iAdapterOwnerBalance = await ethers.provider.getBalance(ADAPTER_OWNER)
    const iTestFulfillSwapBalance = await ethers.provider.getBalance(this.testFulfillSwap.address)

    // executor submits a tx with the signed message, and callData to source the NFT from TestFulfillSwap
    await this.brinkAccountForExecutor.sendLimitSwap(
      signedMsg, this.nftAdapter.address, adapterCallData
    )

    // test final conditions: proxy account receives the NFT, TestFulfillSwap receives 1.0 ETH, ADAPTER_OWNER receives huge ETH arb
    expect(await this.testNft.ownerOf(this.testNftId)).to.equal(this.proxyAccount.address)
    const fAdapterOwnerBalance = await ethers.provider.getBalance(ADAPTER_OWNER)
    const fTestFulfillSwapBalance = await ethers.provider.getBalance(this.testFulfillSwap.address)
    expect(fTestFulfillSwapBalance.sub(iTestFulfillSwapBalance)).to.equal(nftCost)
    expect(fAdapterOwnerBalance.sub(iAdapterOwnerBalance) / 10**18).to.be.greaterThan(0)
  })

  it('when target of ERC721.safeTransferFrom, transfers the NFT without revert', async function () {
    await this.testNft.mint(this.whale.address, 123)
    await this.testNft.connect(this.whale).approve(this.nftAdapter.address, 123)
    await expect(this.testNft.connect(this.whale)['safeTransferFrom(address,address,uint256)'](this.whale.address, this.nftAdapter.address, 123)).not.to.be.reverted
  })

  it('when ETH remaining is zero', async function () {
    const ethAmountTotal = ethers.utils.parseEther('1.0')

    // transfer 1 ETH to account
    await this.whale.sendTransaction({
      to: this.proxyAccount.address,
      value: ethAmountTotal
    })

    // Brink account owner signs a tokenToNft message to buy any testNft for `paidAmount`
    const signedMsg = await this.brinkSigner.signMetaDelegateCall(
      this.nftApprovalSwapVerifier.address,
      {
        functionName: 'tokenToNft',
        paramTypes: TOKEN_TO_NFT_APPROVAL_VERIFIER_PARAM_TYPES,
        params: [
          '0', '1', ETH_ADDRESS, this.testNft.address, ethAmountTotal.toString(), this.expiryBlock.toString()
        ]
      }
    )

    // callData executer uses to source the swap
    const fulfillSwapCallData = encodeFunctionCall(
      'fulfillNftOutSwap',
      ['address', 'uint256', 'address'],
      [this.testNft.address, this.testNftId, this.nftAdapter.address]
    )
    const adapterCallData = encodeFunctionCall(
      'buyWithEth',
      ['address', 'bytes', 'uint256', 'address', 'uint256', 'address'],
      [this.testFulfillSwap.address, fulfillSwapCallData, ethAmountTotal, this.testNft.address, this.testNftId, this.proxyAccount.address]
    )

    // initial conditions: TestFulfillSwap contract has the NFT, proxy account has 1.0 ETH
    expect(await this.testNft.ownerOf(this.testNftId)).to.equal(this.testFulfillSwap.address)
    expect(await ethers.provider.getBalance(this.proxyAccount.address)).to.equal(ethAmountTotal)
    const iAdapterOwnerBalance = await ethers.provider.getBalance(ADAPTER_OWNER)
    const iTestFulfillSwapBalance = await ethers.provider.getBalance(this.testFulfillSwap.address)

    // executor submits a tx with the signed message, and callData to source the NFT from TestFulfillSwap
    await this.brinkAccountForExecutor.sendLimitSwap(
      signedMsg, this.nftAdapter.address, adapterCallData
    )

    // test final conditions: proxy account receives the NFT, TestFulfillSwap receives 1.0 ETH, ADAPTER_OWNER receives 0 ETH arb
    expect(await this.testNft.ownerOf(this.testNftId)).to.equal(this.proxyAccount.address)
    const fAdapterOwnerBalance = await ethers.provider.getBalance(ADAPTER_OWNER)
    const fTestFulfillSwapBalance = await ethers.provider.getBalance(this.testFulfillSwap.address)
    expect(fTestFulfillSwapBalance.sub(iTestFulfillSwapBalance)).to.equal(ethAmountTotal)
    expect(fAdapterOwnerBalance.sub(iAdapterOwnerBalance)).to.equal(0)
  })
})
