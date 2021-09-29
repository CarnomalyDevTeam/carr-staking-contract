//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../libs/Utility.sol";
import "hardhat/console.sol";

contract Ownable {
    address public owner;
    event OwnershipRenounced(address indexed previousOwner);
    event OwnershipTransferred(
        address indexed previousOwner,
        address indexed newOwner
    );

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner);
        _;
    }

    function renounceOwnership() public onlyOwner {
        emit OwnershipRenounced(owner);
        owner = address(0);
    }

    function transferOwnership(address _newOwner) public onlyOwner {
        _transferOwnership(_newOwner);
    }

    function _transferOwnership(address _newOwner) internal {
        require(_newOwner != address(0));
        emit OwnershipTransferred(owner, _newOwner);
        owner = _newOwner;
    }
}

contract Staking is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public stakingToken;
    uint256 private _totalSupply;
    uint256 private _periodFinish;
    address[] private _stakers;
    mapping(address => uint256) private _stake;
    mapping(address => uint256) private _updated;

    event Recovered(address token, uint256 amount);
    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event StakingEnds(uint256 newTimestamp);

    constructor(address _stakingToken) {
        stakingToken = IERC20(_stakingToken);
        _periodFinish = block.timestamp + 31536000;
        emit StakingEnds(_periodFinish);
    }

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address _user) external view returns (uint256) {
        return _stake[_user];
    }

    function _lastTimeRewardApplicable() internal view returns (uint256) {
        return
            block.timestamp < _periodFinish ? block.timestamp : _periodFinish;
    }

    function total() external view hasBalance(msg.sender) returns (uint256) {
        return _stake[msg.sender] + _getNewRewards(msg.sender);
    }

    function stake(uint256 amount)
        external
        nonReentrant
        inStakingPeriod
        updateRewards(msg.sender)
    {
        _totalSupply += amount;
        _stake[msg.sender] += amount;
        _stakers.push(msg.sender);
        require(stakingToken.transferFrom(msg.sender, address(this), amount), "Token Transfer Failed");
        emit Staked(msg.sender, amount);
    }

    function withdraw(uint256 amount)
        public
        nonReentrant
        hasBalance(msg.sender)
        updateRewards(msg.sender)
    {
        require(amount > 0, "You must specify a positive amount of money");
        require(_stake[msg.sender] >= amount, "Not enough tokens");
        _withdraw(msg.sender, amount);
    }

    function withdrawAll()
        public
        nonReentrant
        hasBalance(msg.sender)
        updateRewards(msg.sender)
    {
        _withdraw(msg.sender, _stake[msg.sender]);
    }

    function _withdraw(address to, uint256 amount)
        private
        hasBalance(to)
        updateRewards(msg.sender)
    {
        require(amount <= _totalSupply, "Not enough tokens");
        _totalSupply -= amount;
        _stake[to] -= amount;
        require(stakingToken.transfer(to, amount), "Token Transfer Failed");
        emit Withdrawn(to, amount);
    }

    function rewardsOf(address addr) public view returns (uint256) {
        return _getNewRewards(addr);
    }

    function _getNewRewards(address addr) private view returns (uint256) {
        uint256 etime = _lastTimeRewardApplicable() - _updated[addr];
        if (etime == 0 || _stake[addr] == 0) {
            return 0;
        }
        // _ratio = 6341958397; // 20% apr : This represents === Rate / Time * 10^18 === .20 / 31536000 * 10^18
        uint256 reward = Utility.compound(_stake[addr], 6341958397, etime);
        return reward - _stake[addr];
    }

    function setFinish(uint256 _finish) external onlyOwner {
        _periodFinish = _finish;
        emit StakingEnds(_finish);
    }

    function recoverERC20(address addr, uint256 amt) public onlyOwner {
        IERC20 theToken = IERC20(addr);
        require(theToken.transfer(msg.sender, amt), "Token Transfer Failed");
        emit Recovered(addr, amt);
    }

    function tokensNeeded() public view returns(uint256) {
        address[] memory counted;
        uint256 needed = _totalSupply;
        uint stakersLen = _stakers.length;
        for(uint i=0; i < stakersLen; i++) {
            bool found = false;
            uint countedLen = counted.length;
            for(uint j=0; j < countedLen; j++) {
                if (counted[j] == _stakers[i]) {
                    found = true;
                }
            }
            if (found) continue;
            needed += _stake[_stakers[i]] + rewardsOf(_stakers[i]);
        }
        return needed;
    }

    modifier updateRewards(address addr) {
        uint256 newRewards = _getNewRewards(addr);
        _updated[addr] = _lastTimeRewardApplicable();
        if (newRewards > 0) {
            _stake[addr] += newRewards;
            _totalSupply += newRewards;
            emit Staked(addr, newRewards);
        }
        _;
    }

    modifier inStakingPeriod() {
        require(block.timestamp <= _periodFinish, "Staking period has ended");
        _;
    }

    modifier hasBalance(address addr) {
        require(_stake[addr] > 0, "No balance");
        _;
    }
}
