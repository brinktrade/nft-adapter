const { ethers } = require('hardhat')
const deploySaltedBytecode = require('@brinkninja/core/test/helpers/deploySaltedBytecode')

async function deployContract (contractName, paramTypes = [], paramValues = []) {
  const ContractFactory = await ethers.getContractFactory(contractName)
  const address = await deploySaltedBytecode(ContractFactory.bytecode, paramTypes, paramValues)
  const contractInstance = await ethers.getContractAt(contractName, address)
  return contractInstance
}

module.exports = deployContract
