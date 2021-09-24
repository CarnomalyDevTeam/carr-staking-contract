const { expect } = require("chai");
const qty = "100000000000000000000000";
const month_in_seconds = 2628000;
const r = {
  m1: "1680633033310046341168",
  m2: "3389511340546621956208",
  m12m1: "22140274964779807753125",
  m12: "22140275739388350171449",
};
describe("Staking Contract", function () {
  let ERC20TokenContract;
  let StakingContract;
  let ERC20Token;
  let Staking;
  let owner;
  let addr1;
  let addr2;
  let addrs;
  let depositTime;

  before(async function () {
    [owner, addr1, addr2, ...addrs] = await ethers.getSigners();
    ERC20TokenContract = await ethers.getContractFactory("CARR");
    // [walletOwner, wallet1, ...wallets] = ethers.getWallets();
    StakingContract = await ethers.getContractFactory("Staking");
    ERC20Token = await ERC20TokenContract.deploy();
    Staking = await StakingContract.deploy(ERC20Token.address);
    await ERC20Token.transfer(addr1.address, qty);
  });
  describe("debug", async function () {
    it("Does not accept ether", async function () {
      const params = { to: Staking.address, value: ethers.utils.parseEther("1.0") };
      await expect(owner.sendTransaction(params)).to.be.reverted;
      await expect(addr1.sendTransaction(params)).to.be.reverted;
    });
  });
  describe("Deployment", async function () {
    describe("Ownership", async function () {
      it("Is owned by the deployer", async function () {
        expect(await Staking.owner()).to.equal(owner.address);
      });
      it("Allows successful ownership transfer", async function () {
        await expect(Staking.transferOwnership(addr1.address)).to.emit(Staking, "OwnershipTransferred").withArgs(owner.address, addr1.address);
        expect(await Staking.owner()).to.equal(addr1.address);
      });
      it("Allows ownership to revert back", async function () {
        await expect(Staking.connect(addr1).transferOwnership(owner.address)).to.emit(Staking, "OwnershipTransferred").withArgs(addr1.address, owner.address);
        expect(await Staking.owner()).to.equal(owner.address);
      });
    });
    describe("Balances", async function () {
      it("Has no balance for the owner", async function () {
        expect(await Staking.balanceOf(owner.address)).to.equal(0);
      });
      it("Has no rewards for the owner", async function () {
        expect(await Staking.rewardsOf(owner.address)).to.equal(0);
      });
      it("Has no balance for regular users", async function () {
        expect(await Staking.balanceOf(addr1.address)).to.equal(0);
      });
      it("Has no rewards for regular users", async function () {
        expect(await Staking.rewardsOf(addr1.address)).to.equal(0);
      });
      it("Has no totalSupply", async function () {
        expect(await Staking.totalSupply()).to.equal(0);
      });
    })
    describe("Carr Management", async function () {
      it("Has an balance of CARR tokens to distribute", async function () {
        expect(await ERC20Token.balanceOf(Staking.address)).to.equal("5000000000000000000000000");
      });
      it("Can receive CARR directly", async function () {
        await ERC20Token.transfer(Staking.address, "1000")
        expect(await ERC20Token.balanceOf(Staking.address)).to.equal("5000000000000000000001000");
      });
      it("Can recover CARR to owner address", async function () {
        await expect(Staking.recoverERC20(ERC20Token.address, "1000")).to.emit(Staking, "Recovered").withArgs(ERC20Token.address, "1000")
        expect(await ERC20Token.balanceOf(Staking.address)).to.equal("5000000000000000000000000");
      });
    });
  });
  describe("Active", async function () {
    it("Accepts deposits", async function () {
      await ERC20Token.approve(Staking.address, qty);  // owner stakes qty
      await expect(Staking.stake(qty)).to.emit(Staking, 'Staked').withArgs(owner.address, qty);
      depositTime = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp;
      expect(await Staking.balanceOf(owner.address)).to.equal(qty);
    });
    it("Has no rewards initially", async function () {
      expect(await Staking.rewardsOf(owner.address)).to.equal("0");
    });
    it("Allows deposits from regular users", async function () {
      await ERC20Token.connect(addr1).approve(Staking.address, qty);  // owner stakes qty
      await expect(Staking.connect(addr1).stake(qty)).to.emit(Staking, 'Staked').withArgs(addr1.address, qty);
      expect(await Staking.balanceOf(addr1.address)).to.equal(qty);
    });
    it("Set the finishTime to 1 year after deposit", async function () {
      await expect(Staking.setFinish(depositTime + 31536000))
        .to.emit(Staking, "StakingEnds").withArgs(depositTime + 31536000); // finish 1 year after deposit
    });
    it("Verifies interest after 1 month", async function () {
      await ff(month_in_seconds);
      expect(await Staking.rewardsOf(owner.address)).to.equal(r.m1);
    });
    it("Verifies interest after 2 months", async function () {
      await ff(2 * month_in_seconds);
      expect(await Staking.rewardsOf(owner.address)).to.equal(r.m2);
    });
    it("Verifies interest after 1 year (- 1 second)", async function () {
      await ff(12 * month_in_seconds - 1);
      expect(await Staking.rewardsOf(owner.address)).to.equal(r.m12m1);
    });
    it("Verifies interest after 1 year", async function () {
      await ff(12 * month_in_seconds);
      expect(await Staking.rewardsOf(owner.address)).to.equal(r.m12);
    });
  });
  describe("Finished", async function () {
    it("Stops accepting deposits", async function () {
      // await ERC20Token.approve(Staking.address, qty);  // owner stakes qty
      await expect(Staking.stake(qty)).to.be.revertedWith("Staking period has ended");
    });
    it("Stops increasing rewards", async function () {
      await ff(month_in_seconds * 12 + 1);
      expect(await Staking.rewardsOf(owner.address)).to.equal(r.m12);
      await ff(month_in_seconds * 13);
      expect(await Staking.rewardsOf(owner.address)).to.equal(r.m12);
    });
    it("Has expected totalSupply", async function () {
      expect(await Staking.totalSupply()).to.equal("200000000000000000000000");
    });
    it("Allows withdrawals", async function () {
      // emit Withdrawn(to, amount);
      await expect(Staking.withdraw(qty))
        .to.emit(Staking, "Withdrawn").withArgs(owner.address, qty)
        .to.emit(Staking, 'Staked').withArgs(owner.address, r.m12);
      expect(await Staking.balanceOf(owner.address)).to.equal(r.m12);
      expect(await ERC20Token.balanceOf(owner.address)).to.equal("4900000000000000000000000");
    });
    it("Has expected totalSupply", async function () {
      expect(await Staking.totalSupply()).to.equal("122140275739388350171449");
    });
    it("Allows full withdrawals", async function () {
      await expect(Staking.withdrawAll())
        .to.emit(Staking, "Withdrawn").withArgs(owner.address, r.m12)
        .to.not.emit(Staking, "Staked");
      expect(await Staking.balanceOf(owner.address)).to.equal(0);
      expect(await ERC20Token.balanceOf(owner.address)).to.equal("4922140275739388350171449");
    });
    it("Has expected totalSupply", async function () {
      expect(await Staking.totalSupply()).to.equal("100000000000000000000000");
    });
    it("Allows withdrawals from regular user", async function () {
      await expect(Staking.connect(addr1).withdraw(qty))
        .to.emit(Staking, 'Withdrawn').withArgs(addr1.address, qty)
        .to.emit(Staking, 'Staked').withArgs(addr1.address, "22140274190171270240817");
      expect(await Staking.balanceOf(addr1.address)).to.equal("22140274190171270240817");
      expect(await ERC20Token.balanceOf(addr1.address)).to.equal("100000000000000000000000");
      expect(await Staking.totalSupply()).to.equal("22140274190171270240817");
    });
    it("Allows regular users to withdrawAll", async function () {
      await expect(Staking.connect(addr1).withdrawAll())
        .to.emit(Staking, 'Withdrawn')
        .to.not.emit(Staking, "Staked");
        expect(await Staking.balanceOf(addr1.address)).to.equal("0");
      expect(await ERC20Token.balanceOf(addr1.address)).to.equal("122140274190171270240817");
      expect(await Staking.totalSupply()).to.equal("0");
    });
    it("Can receive CARR directly", async function () {
      await ERC20Token.transfer(Staking.address, qty)
      expect(await ERC20Token.balanceOf(Staking.address)).to.equal("5055719450070440379587734");
    });
    it("Can recover CARR to owner address", async function () {
      const q = "55719450070440379587734";
      await expect(Staking.recoverERC20(ERC20Token.address, q)).to.emit(Staking, "Recovered").withArgs(ERC20Token.address, q)
      expect(await ERC20Token.balanceOf(Staking.address)).to.equal("5000000000000000000000000");
    });

  });
  async function ff(t) {
    let block = await ethers.provider.getBlock(await ethers.provider.getBlockNumber());
    const deltaT = depositTime + t - block.timestamp;
    if (deltaT) {
      await ethers.provider.send('evm_increaseTime', [deltaT]); // one year
      await hre.ethers.provider.send('evm_mine');
    }
  }
});
