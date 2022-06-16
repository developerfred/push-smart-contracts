const { ethers,waffle } = require("hardhat");

const {
  tokensBN,
} = require("../../helpers/utils");


const {epnsContractFixture,tokenFixture} = require("../common/fixtures")
const {expect} = require("../common/expect")
const createFixtureLoader = waffle.createFixtureLoader;


describe("EPNS CoreV2 Protocol", function () {
  const ADD_CHANNEL_MIN_POOL_CONTRIBUTION = tokensBN(50)
  const ADD_CHANNEL_MAX_POOL_CONTRIBUTION = tokensBN(250000 * 50)
  const TOTAL_SUPPLY = tokensBN(10e6)
  const ADJUST_FOR_FLOAT = 10 ** 7

  let PushToken;
  let EPNSCoreV1Proxy;
  let EPNSCommV1Proxy;
  let ADMIN;
  let ALICE;
  let BOB;
  let CHARLIE;
  let CHANNEL_CREATOR;
  let ADMINSIGNER;
  let ALICESIGNER;
  let BOBSIGNER;
  let CHARLIESIGNER;
  let CHANNEL_CREATORSIGNER;


  let loadFixture;
  before(async() => {
    [wallet, other] = await ethers.getSigners()
    loadFixture = createFixtureLoader([wallet, other])
  });

  beforeEach(async function () {
    // Get the ContractFactory and Signers here.
    const [
      adminSigner,
      aliceSigner,
      bobSigner,
      charlieSigner,
      channelCreatorSigner,
    ] = await ethers.getSigners();

    ADMINSIGNER = adminSigner;
    ALICESIGNER = aliceSigner;
    BOBSIGNER = bobSigner;
    CHARLIESIGNER = charlieSigner;
    CHANNEL_CREATORSIGNER = channelCreatorSigner;

    ADMIN = await adminSigner.getAddress();
    ALICE = await aliceSigner.getAddress();
    BOB = await bobSigner.getAddress();
    CHARLIE = await charlieSigner.getAddress();
    CHANNEL_CREATOR = await channelCreatorSigner.getAddress();

    ({
      PROXYADMIN,
      EPNSCoreV1Proxy,
      EPNSCommV1Proxy, 
      ROUTER,
      PushToken,
    } = await loadFixture(epnsContractFixture)); 

    ({MOCKDAI, ADAI} = await loadFixture(tokenFixture));
	});

	// TODO: need to update the cliam rewards 
	describe('EPNS CORE: CLAIM REWARD TEST', () => {
		const CHANNEL_TYPE = 2;
		const TEST_CHANNEL_CTX = ethers.utils.toUtf8Bytes("test-channel-hello-world");

		beforeEach(async function(){
			await EPNSCoreV1Proxy.connect(ADMINSIGNER).setEpnsCommunicatorAddress(EPNSCommV1Proxy.address)
			await EPNSCommV1Proxy.connect(ADMINSIGNER).setEPNSCoreAddress(EPNSCoreV1Proxy.address);
			
			await PushToken.approve(EPNSCoreV1Proxy.address,TOTAL_SUPPLY);
			await PushToken.connect(BOBSIGNER).approve(EPNSCoreV1Proxy.address, TOTAL_SUPPLY);
			await PushToken.connect(ALICESIGNER).approve(EPNSCoreV1Proxy.address, TOTAL_SUPPLY);
			await PushToken.connect(CHARLIESIGNER).approve(EPNSCoreV1Proxy.address, TOTAL_SUPPLY);

			await PushToken.connect(ALICESIGNER).setHolderDelegation(EPNSCoreV1Proxy.address,true);
			await PushToken.connect(BOBSIGNER).setHolderDelegation(EPNSCoreV1Proxy.address,true);
			await PushToken.connect(CHARLIESIGNER).setHolderDelegation(EPNSCoreV1Proxy.address,true);
		});

		const createChannelWithCustomFee = async(fee)=>{
			await EPNSCoreV1Proxy.createChannelWithPUSH(CHANNEL_TYPE, TEST_CHANNEL_CTX, fee,0);
		}

		const gotoBlockNumber = async(blockNumber) =>{
			blockNumber = blockNumber.toNumber();
			const currentBlock = await ethers.provider.getBlock("latest");
			const numBlockToIncrease = blockNumber - currentBlock.number;
			const blockIncreaseHex = `0x${numBlockToIncrease.toString(16)}`;
			await ethers.provider.send("hardhat_mine", [blockIncreaseHex]);
		}

		it("Tests for multiple users claming reward at same transaction", async function(){	
			const PUSH_BORN = await PushToken.born();
			const BLOCK_GAP = 2000;
			const WITHDRWAL_BLOCK_NUM = PUSH_BORN.add(BLOCK_GAP);

			// Add 4000 PUSH to pool by creating the channel
			await createChannelWithCustomFee(tokensBN(4_000))
			const poolFunds = await EPNSCoreV1Proxy.POOL_FUNDS();
			expect(poolFunds).to.equal(tokensBN(4_000))

			
			// Alice gets: 5K PUSH
			// Bob gets: 4K PUSH
			// Charlie gets: 3K PUSH 
			await PushToken.transfer(ALICE, tokensBN(5_000_000));
			await PushToken.transfer(BOB, tokensBN(4_000_000));
			await PushToken.transfer(CHARLIE, tokensBN(3_000_000));
						
			const [aliceWt, bobWt, charlieWt] = await Promise.all([
				PushToken.returnHolderUnits(ALICE,WITHDRWAL_BLOCK_NUM),
				PushToken.returnHolderUnits(BOB,WITHDRWAL_BLOCK_NUM),
				PushToken.returnHolderUnits(CHARLIE,WITHDRWAL_BLOCK_NUM),
			]); 

			// assert userholder wt
			expect(aliceWt).to.equal(tokensBN(10_000_000_000))
			expect(bobWt).to.equal(tokensBN(8_000_000_000))
			expect(charlieWt).to.equal(tokensBN(6_000_000_000))


			// move to one block before `WITHDRWAL_BLOCK_NUM` 
			await gotoBlockNumber(WITHDRWAL_BLOCK_NUM.sub(1))

			// add multiple transaction in single block
			await ethers.provider.send("evm_setAutomine", [false]);
			await Promise.all([
				EPNSCoreV1Proxy.connect(ALICESIGNER).claimRewards(),
				EPNSCoreV1Proxy.connect(BOBSIGNER).claimRewards(),
				EPNSCoreV1Proxy.connect(CHARLIESIGNER).claimRewards(),
			]);
			await network.provider.send("evm_mine"); 
			await ethers.provider.send("evm_setAutomine", [true]);

			// after claim rewards currentBlock should equal `WITHDRWAL_BLOCK_NUM`
			const currentBlock = await ethers.provider.getBlock("latest");
			expect(currentBlock.number).to.equal(WITHDRWAL_BLOCK_NUM);
			
			// finally assert reward yields
			const [aliceRw, bobRw, charlieRw] = await Promise.all([
				EPNSCoreV1Proxy.usersRewardsClaimed(ALICE),
				EPNSCoreV1Proxy.usersRewardsClaimed(BOB),
				EPNSCoreV1Proxy.usersRewardsClaimed(CHARLIE),
			]); 
			expect(aliceRw).to.equal(ethers.utils.parseEther("200"))
			expect(bobRw).to.equal(ethers.utils.parseEther("152"))
			expect(charlieRw).to.equal(ethers.utils.parseEther("109.44"))
		})

		it("Tests for multiple users claming reward at diffrent block times", async function(){	
			const PUSH_BORN = await PushToken.born();

			// Add 4000 PUSH to pool by creating the channel
			await createChannelWithCustomFee(tokensBN(4_000))
			
			// Alice gets: 40M PUSH
			// Bob gets: 20M PUSH
			// Charlie gets: 10M PUSH 
			await PushToken.transfer(ALICE, tokensBN(40_000_000));
			await PushToken.transfer(BOB, tokensBN(20_000_000));
			await PushToken.transfer(CHARLIE, tokensBN(10_000_000));

			const [ALICE_BLOCK, BOB_BLOCK, CHARLIE_BLOCK] = [
				PUSH_BORN.add(2_000), 
				PUSH_BORN.add(3_000), 
				PUSH_BORN.add(4_000)
			]				
			const [aliceWt, bobWt, charlieWt] = await Promise.all([
				PushToken.returnHolderUnits(ALICE,ALICE_BLOCK),
				PushToken.returnHolderUnits(BOB,BOB_BLOCK),
				PushToken.returnHolderUnits(CHARLIE,CHARLIE_BLOCK),
			]); 

			// assert userholder wt
			expect(aliceWt).to.equal(tokensBN(80_000_000_000))
			expect(bobWt).to.equal(tokensBN(60_000_000_000))
			expect(charlieWt).to.equal(tokensBN(40_000_000_000))

			// move to one block before `WITHDRWAL_BLOCK_NUM` and claim rewards 
			await gotoBlockNumber(ALICE_BLOCK.sub(1));
			await EPNSCoreV1Proxy.connect(ALICESIGNER).claimRewards();

			await gotoBlockNumber(BOB_BLOCK.sub(1));
			await EPNSCoreV1Proxy.connect(BOBSIGNER).claimRewards();

			await gotoBlockNumber(CHARLIE_BLOCK.sub(1));
			await EPNSCoreV1Proxy.connect(CHARLIESIGNER).claimRewards();
			
			
			// finally assert reward yields
			const [aliceRw, bobRw, charlieRw] = await Promise.all([
				EPNSCoreV1Proxy.usersRewardsClaimed(ALICE),
				EPNSCoreV1Proxy.usersRewardsClaimed(BOB),
				EPNSCoreV1Proxy.usersRewardsClaimed(CHARLIE),
			]); 
			expect(aliceRw).to.equal(ethers.utils.parseEther("1600"))
			expect(bobRw).to.equal(ethers.utils.parseEther("480"))
			expect(charlieRw).to.equal(ethers.utils.parseEther("192"))
		})

		it("Reduces the rewards in every withdrwal", async function(){	
			const PUSH_BORN = await PushToken.born();

			// Add 4000 PUSH to pool by creating the channel
			await createChannelWithCustomFee(tokensBN(4_000))
			
			// Alice gets: 40M PUSH
			await PushToken.transfer(ALICE, tokensBN(40_000_000));

			const [BG_CLAIM_1, BG_CLAIM_2, BG_CLAIM_3] = [
				PUSH_BORN.add(1_000), 
				PUSH_BORN.add(5_000), 
				PUSH_BORN.add(10_000)
			]				

			// On first claim
			await gotoBlockNumber(BG_CLAIM_1.sub(1));
			const ALICE_WT_1 = await PushToken.returnHolderUnits(ALICE,BG_CLAIM_1);
			expect(ALICE_WT_1).to.equal(tokensBN(40_000_000_000))
			await EPNSCoreV1Proxy.connect(ALICESIGNER).claimRewards();
			const firstRewardClaimed = await EPNSCoreV1Proxy.usersRewardsClaimed(ALICE);
			expect(firstRewardClaimed).to.equal(ethers.utils.parseEther("1600"));
			const aliceBlanceAfterFirstClaim = await PushToken.balanceOf(ALICE);
			const expectedBalAferFirstClaim = tokensBN(40000000).add(tokensBN(1600));
			expect(aliceBlanceAfterFirstClaim).to.equal(expectedBalAferFirstClaim);

			// On second claim
			await gotoBlockNumber(BG_CLAIM_2.sub(1));
			const ALICE_WT_2 = await PushToken.returnHolderUnits(ALICE,BG_CLAIM_2);
			expect(ALICE_WT_2).to.equal(tokensBN(1.600064e11))
			await EPNSCoreV1Proxy.connect(ALICESIGNER).claimRewards();
			const secondRewardClaimed = await EPNSCoreV1Proxy.usersRewardsClaimed(ALICE);
			// new reward = 1600 + 768.03072
			expect(secondRewardClaimed).to.equal(ethers.utils.parseEther("2368.03072")) 
			const aliceBlanceAfterSecondClaim = await PushToken.balanceOf(ALICE);
			const expectedBalAferSecondClaim = tokensBN(40_000_000).add(ethers.utils.parseEther("2368.03072"))
			expect(aliceBlanceAfterSecondClaim).to.equal(expectedBalAferSecondClaim);

			// On third cliam
			await gotoBlockNumber(BG_CLAIM_3.sub(1));
			const ALICE_WT_3 = await PushToken.returnHolderUnits(ALICE,BG_CLAIM_3);
			expect(ALICE_WT_3).to.equal(ethers.utils.parseEther("200011840153.6"))
			await EPNSCoreV1Proxy.connect(ALICESIGNER).claimRewards();
			const thirdRewardClaimed = await EPNSCoreV1Proxy.usersRewardsClaimed(ALICE);
			// new reward = 1600 + 768.03072 + 326.413178766946..
			expect(thirdRewardClaimed).to.be.closeTo(ethers.utils.parseEther("2694.443898766946"),ethers.utils.parseEther("0.0001"));	
		})




	});
});
