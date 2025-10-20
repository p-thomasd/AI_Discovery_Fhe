pragma solidity ^0.8.24;
import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract AIDiscoveryFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error InvalidBatch();
    error InvalidParameter();
    error ReplayDetected();
    error StateMismatch();
    error InvalidProof();
    error NotInitialized();

    address public owner;
    mapping(address => bool) public isProvider;
    bool public paused;
    uint256 public cooldownSeconds;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    uint256 public currentBatchId;
    mapping(uint256 => bool) public isBatchOpen;
    mapping(uint256 => euint32[]) public encryptedDataBatches;

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event PauseToggled(bool indexed isPaused);
    event CooldownSecondsSet(uint256 indexed oldCooldown, uint256 indexed newCooldown);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event DataSubmitted(address indexed provider, uint256 indexed batchId, uint256 count);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint256 result);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier submissionRateLimited() {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        lastSubmissionTime[msg.sender] = block.timestamp;
        _;
    }

    modifier decryptionRequestRateLimited() {
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        lastDecryptionRequestTime[msg.sender] = block.timestamp;
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function addProvider(address provider) external onlyOwner {
        if (provider == address(0)) revert InvalidParameter();
        isProvider[provider] = true;
        emit ProviderAdded(provider);
    }

    function removeProvider(address provider) external onlyOwner {
        if (!isProvider[provider]) revert InvalidParameter();
        delete isProvider[provider];
        emit ProviderRemoved(provider);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PauseToggled(_paused);
    }

    function setCooldownSeconds(uint256 _cooldownSeconds) external onlyOwner {
        uint256 oldCooldown = cooldownSeconds;
        cooldownSeconds = _cooldownSeconds;
        emit CooldownSecondsSet(oldCooldown, _cooldownSeconds);
    }

    function openBatch() external onlyOwner whenNotPaused {
        currentBatchId++;
        isBatchOpen[currentBatchId] = true;
        emit BatchOpened(currentBatchId);
    }

    function closeBatch(uint256 batchId) external onlyOwner {
        if (!isBatchOpen[batchId]) revert InvalidBatch();
        isBatchOpen[batchId] = false;
        emit BatchClosed(batchId);
    }

    function submitData(uint256 batchId, euint32[] calldata dataPoints) external onlyProvider whenNotPaused submissionRateLimited {
        if (!isBatchOpen[batchId]) revert InvalidBatch();
        for (uint i = 0; i < dataPoints.length; i++) {
            _initIfNeeded(dataPoints[i]);
            encryptedDataBatches[batchId].push(dataPoints[i]);
        }
        emit DataSubmitted(msg.sender, batchId, dataPoints.length);
    }

    function requestDiscovery(uint256 batchId) external onlyProvider whenNotPaused decryptionRequestRateLimited {
        if (isBatchOpen[batchId]) revert InvalidBatch(); // Must be closed
        euint32[] storage data = encryptedDataBatches[batchId];
        if (data.length == 0) revert InvalidBatch();

        euint32 sum = FHE.asEuint32(0);
        for (uint i = 0; i < data.length; i++) {
            sum = sum.add(data[i]);
        }
        euint32 average = sum.mul(FHE.asEuint32(1000)).div(FHE.asEuint32(data.length)); // average * 1000

        euint32[] memory cts = new euint32[](1);
        cts[0] = average;

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);
        decryptionContexts[requestId] = DecryptionContext({ batchId: batchId, stateHash: stateHash, processed: false });
        emit DecryptionRequested(requestId, batchId);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        if (decryptionContexts[requestId].processed) revert ReplayDetected();
        // Security: Replay protection ensures this callback is processed only once.

        euint32[] memory cts = new euint32[](1);
        {
            uint256 batchId = decryptionContexts[requestId].batchId;
            euint32[] storage data = encryptedDataBatches[batchId];
            euint32 sum = FHE.asEuint32(0);
            for (uint i = 0; i < data.length; i++) {
                sum = sum.add(data[i]);
            }
            euint32 average = sum.mul(FHE.asEuint32(1000)).div(FHE.asEuint32(data.length));
            cts[0] = average;
        }
        bytes32 currentHash = _hashCiphertexts(cts);
        // Security: State hash verification ensures the contract state relevant to the decryption request
        // has not changed since the request was made, preventing inconsistent decryptions.
        if (currentHash != decryptionContexts[requestId].stateHash) revert StateMismatch();

        if (!FHE.checkSignatures(requestId, cleartexts, proof)) revert InvalidProof();

        uint256 result = abi.decode(cleartexts, (uint256));
        decryptionContexts[requestId].processed = true;
        emit DecryptionCompleted(requestId, decryptionContexts[requestId].batchId, result);
    }

    function _hashCiphertexts(euint32[] memory cts) internal pure returns (bytes32) {
        bytes32[] memory ctsAsBytes = new bytes32[](cts.length);
        for (uint i = 0; i < cts.length; i++) {
            ctsAsBytes[i] = FHE.toBytes32(cts[i]);
        }
        return keccak256(abi.encode(ctsAsBytes, address(this)));
    }

    function _initIfNeeded(euint32 v) internal {
        if (!v.isInitialized()) revert NotInitialized();
    }

    function _requireInitialized(euint32 v) internal view {
        if (!v.isInitialized()) revert NotInitialized();
    }
}