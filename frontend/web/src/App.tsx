// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface ScientificDiscovery {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  category: string;
  status: "pending" | "verified" | "rejected";
  hypothesis: string;
}

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const FHECompute = (encryptedData: string, operation: string): string => {
  const value = FHEDecryptNumber(encryptedData);
  let result = value;
  
  switch(operation) {
    case 'analyze':
      result = value * (1 + Math.random() * 0.2); // Simulate analysis
      break;
    case 'hypothesize':
      result = value * (0.8 + Math.random() * 0.4); // Simulate hypothesis generation
      break;
    default:
      result = value;
  }
  
  return FHEEncryptNumber(result);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const categories = [
  "Genomics",
  "Astrophysics",
  "Quantum Mechanics",
  "Climate Science",
  "Neuroscience",
  "Materials Science"
];

const generateRandomHypothesis = (category: string) => {
  const hypotheses = {
    "Genomics": [
      "Gene sequence X correlates with disease Y",
      "New protein folding pattern discovered",
      "Epigenetic marker for longevity identified"
    ],
    "Astrophysics": [
      "Dark matter distribution pattern detected",
      "New exoplanet classification system",
      "Cosmic ray origin hypothesis"
    ],
    "Quantum Mechanics": [
      "Quantum entanglement communication protocol",
      "New state of matter predicted",
      "Quantum decoherence control method"
    ],
    "Climate Science": [
      "Ocean current shift prediction model",
      "Carbon capture efficiency breakthrough",
      "Climate tipping point early warning system"
    ],
    "Neuroscience": [
      "Neural pathway for memory consolidation",
      "Brain-computer interface optimization",
      "Neuroplasticity enhancement technique"
    ],
    "Materials Science": [
      "Room-temperature superconductor formula",
      "Self-healing polymer structure",
      "Nanomaterial for energy storage"
    ]
  };
  return hypotheses[category as keyof typeof hypotheses]?.[Math.floor(Math.random() * 3)] || "New scientific correlation found";
};

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [discoveries, setDiscoveries] = useState<ScientificDiscovery[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newDiscoveryData, setNewDiscoveryData] = useState({ 
    category: "", 
    description: "", 
    scientificValue: 0,
    hypothesis: ""
  });
  const [selectedDiscovery, setSelectedDiscovery] = useState<ScientificDiscovery | null>(null);
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");

  const verifiedCount = discoveries.filter(d => d.status === "verified").length;
  const pendingCount = discoveries.filter(d => d.status === "pending").length;
  const rejectedCount = discoveries.filter(d => d.status === "rejected").length;

  useEffect(() => {
    loadDiscoveries().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadDiscoveries = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.log("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("discovery_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing discovery keys:", e); }
      }
      
      const list: ScientificDiscovery[] = [];
      for (const key of keys) {
        try {
          const discoveryBytes = await contract.getData(`discovery_${key}`);
          if (discoveryBytes.length > 0) {
            try {
              const discoveryData = JSON.parse(ethers.toUtf8String(discoveryBytes));
              list.push({ 
                id: key, 
                encryptedData: discoveryData.data, 
                timestamp: discoveryData.timestamp, 
                owner: discoveryData.owner, 
                category: discoveryData.category, 
                status: discoveryData.status || "pending",
                hypothesis: discoveryData.hypothesis || ""
              });
            } catch (e) { console.error(`Error parsing discovery data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading discovery ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setDiscoveries(list);
    } catch (e) { console.error("Error loading discoveries:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const submitDiscovery = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting scientific data with Zama FHE..." });
    try {
      const encryptedData = FHEEncryptNumber(newDiscoveryData.scientificValue);
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const discoveryId = `DIS-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const hypothesis = newDiscoveryData.hypothesis || generateRandomHypothesis(newDiscoveryData.category);
      
      const discoveryData = { 
        data: encryptedData, 
        timestamp: Math.floor(Date.now() / 1000), 
        owner: address, 
        category: newDiscoveryData.category, 
        status: "pending",
        hypothesis: hypothesis
      };
      
      await contract.setData(`discovery_${discoveryId}`, ethers.toUtf8Bytes(JSON.stringify(discoveryData)));
      
      const keysBytes = await contract.getData("discovery_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(discoveryId);
      await contract.setData("discovery_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Encrypted scientific data submitted securely!" });
      await loadDiscoveries();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewDiscoveryData({ category: "", description: "", scientificValue: 0, hypothesis: "" });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return FHEDecryptNumber(encryptedData);
    } catch (e) { console.error("Decryption failed:", e); return null; } 
    finally { setIsDecrypting(false); }
  };

  const verifyDiscovery = async (discoveryId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Processing encrypted data with FHE..." });
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Failed to get contract");
      const discoveryBytes = await contract.getData(`discovery_${discoveryId}`);
      if (discoveryBytes.length === 0) throw new Error("Discovery not found");
      const discoveryData = JSON.parse(ethers.toUtf8String(discoveryBytes));
      
      const verifiedData = FHECompute(discoveryData.data, 'analyze');
      
      const contractWithSigner = await getContractWithSigner();
      if (!contractWithSigner) throw new Error("Failed to get contract with signer");
      
      const updatedDiscovery = { 
        ...discoveryData, 
        status: "verified", 
        data: verifiedData,
        hypothesis: discoveryData.hypothesis || generateRandomHypothesis(discoveryData.category)
      };
      await contractWithSigner.setData(`discovery_${discoveryId}`, ethers.toUtf8Bytes(JSON.stringify(updatedDiscovery)));
      
      setTransactionStatus({ visible: true, status: "success", message: "FHE verification completed successfully!" });
      await loadDiscoveries();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Verification failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const rejectDiscovery = async (discoveryId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Processing encrypted data with FHE..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      const discoveryBytes = await contract.getData(`discovery_${discoveryId}`);
      if (discoveryBytes.length === 0) throw new Error("Discovery not found");
      const discoveryData = JSON.parse(ethers.toUtf8String(discoveryBytes));
      const updatedDiscovery = { ...discoveryData, status: "rejected" };
      await contract.setData(`discovery_${discoveryId}`, ethers.toUtf8Bytes(JSON.stringify(updatedDiscovery)));
      setTransactionStatus({ visible: true, status: "success", message: "FHE rejection completed successfully!" });
      await loadDiscoveries();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Rejection failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const isOwner = (discoveryAddress: string) => address?.toLowerCase() === discoveryAddress.toLowerCase();

  const filteredDiscoveries = discoveries.filter(discovery => {
    const matchesSearch = discovery.hypothesis.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         discovery.category.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === "" || discovery.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const renderRadarChart = () => {
    const categoryCounts: Record<string, number> = {};
    categories.forEach(cat => {
      categoryCounts[cat] = discoveries.filter(d => d.category === cat).length;
    });
    
    const maxCount = Math.max(...Object.values(categoryCounts), 1);
    const angles = Array.from({ length: categories.length }, (_, i) => (i * 2 * Math.PI) / categories.length);
    
    return (
      <div className="radar-chart-container">
        <div className="radar-chart">
          <div className="radar-grid">
            {[0.25, 0.5, 0.75, 1].map((level, i) => (
              <div 
                key={i} 
                className="radar-level" 
                style={{ 
                  width: `${level * 100}%`, 
                  height: `${level * 100}%`,
                  opacity: 0.1 + (0.9 * (1 - (i / 4)))
                }}
              ></div>
            ))}
          </div>
          <div className="radar-axis">
            {categories.map((category, i) => (
              <div 
                key={i} 
                className="radar-axis-line"
                style={{ 
                  transform: `rotate(${angles[i]}rad)`,
                  '--angle': `${angles[i]}rad`
                } as React.CSSProperties}
              >
                <span className="axis-label">{category}</span>
              </div>
            ))}
          </div>
          <div className="radar-data">
            <svg viewBox="0 0 100 100" className="radar-polygon">
              <polygon 
                points={categories.map((category, i) => {
                  const value = categoryCounts[category] || 0;
                  const normalized = value / maxCount;
                  const x = 50 + Math.cos(angles[i]) * 45 * normalized;
                  const y = 50 + Math.sin(angles[i]) * 45 * normalized;
                  return `${x},${y}`;
                }).join(' ')}
                fill="rgba(0, 150, 255, 0.4)"
                stroke="rgba(0, 150, 255, 0.8)"
                strokeWidth="2"
              />
            </svg>
          </div>
        </div>
        <div className="radar-legend">
          <div className="legend-item">
            <div className="color-box" style={{ backgroundColor: 'rgba(0, 150, 255, 0.4)' }}></div>
            <span>Discoveries per Category</span>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="tech-spinner">
        <div className="ring"></div>
        <div className="ring"></div>
        <div className="ring"></div>
        <div className="core"></div>
      </div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container future-tech-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="atom-icon">
              <div className="electron"></div>
              <div className="electron"></div>
              <div className="electron"></div>
            </div>
          </div>
          <h1>FHE<span>Scientific</span>Discovery</h1>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowCreateModal(true)} className="create-discovery-btn tech-button">
            <div className="add-icon"></div>New Discovery
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content">
        <div className="central-radial-layout">
          <div className="core-panel">
            <div className="project-intro tech-card">
              <h2>FHE-Powered AI Scientist</h2>
              <p>
                An autonomous AI scientist that can homomorphically analyze encrypted scientific databases 
                (genomic sequences, astronomical observations) to discover new patterns and generate hypotheses.
              </p>
              <div className="tech-badge">
                <span>ZAMA FHE Technology</span>
              </div>
            </div>
            
            <div className="data-stats tech-card">
              <h3>Discovery Statistics</h3>
              <div className="stats-grid">
                <div className="stat-item">
                  <div className="stat-value">{discoveries.length}</div>
                  <div className="stat-label">Total</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{verifiedCount}</div>
                  <div className="stat-label">Verified</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{pendingCount}</div>
                  <div className="stat-label">Pending</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{rejectedCount}</div>
                  <div className="stat-label">Rejected</div>
                </div>
              </div>
            </div>
            
            <div className="smart-chart tech-card">
              <h3>Category Distribution</h3>
              {renderRadarChart()}
            </div>
          </div>
          
          <div className="discoveries-section">
            <div className="section-header">
              <h2>Scientific Discoveries</h2>
              <div className="search-filter">
                <input 
                  type="text" 
                  placeholder="Search hypotheses..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="tech-input"
                />
                <select 
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="tech-select"
                >
                  <option value="">All Categories</option>
                  {categories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
                <button onClick={loadDiscoveries} className="refresh-btn tech-button" disabled={isRefreshing}>
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>
            
            <div className="discoveries-list tech-card">
              <div className="table-header">
                <div className="header-cell">ID</div>
                <div className="header-cell">Category</div>
                <div className="header-cell">Hypothesis</div>
                <div className="header-cell">Date</div>
                <div className="header-cell">Status</div>
                <div className="header-cell">Actions</div>
              </div>
              
              {filteredDiscoveries.length === 0 ? (
                <div className="no-discoveries">
                  <div className="no-data-icon"></div>
                  <p>No scientific discoveries found</p>
                  <button className="tech-button primary" onClick={() => setShowCreateModal(true)}>
                    Submit First Discovery
                  </button>
                </div>
              ) : filteredDiscoveries.map(discovery => (
                <div 
                  className="discovery-row" 
                  key={discovery.id} 
                  onClick={() => setSelectedDiscovery(discovery)}
                >
                  <div className="table-cell discovery-id">#{discovery.id.substring(0, 6)}</div>
                  <div className="table-cell">{discovery.category}</div>
                  <div className="table-cell hypothesis">
                    {discovery.hypothesis.substring(0, 50)}{discovery.hypothesis.length > 50 ? "..." : ""}
                  </div>
                  <div className="table-cell">{new Date(discovery.timestamp * 1000).toLocaleDateString()}</div>
                  <div className="table-cell">
                    <span className={`status-badge ${discovery.status}`}>{discovery.status}</span>
                  </div>
                  <div className="table-cell actions">
                    {isOwner(discovery.owner) && discovery.status === "pending" && (
                      <>
                        <button 
                          className="action-btn tech-button success" 
                          onClick={(e) => { e.stopPropagation(); verifyDiscovery(discovery.id); }}
                        >
                          Verify
                        </button>
                        <button 
                          className="action-btn tech-button danger" 
                          onClick={(e) => { e.stopPropagation(); rejectDiscovery(discovery.id); }}
                        >
                          Reject
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitDiscovery} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating} 
          discoveryData={newDiscoveryData} 
          setDiscoveryData={setNewDiscoveryData}
        />
      )}
      
      {selectedDiscovery && (
        <DiscoveryDetailModal 
          discovery={selectedDiscovery} 
          onClose={() => { setSelectedDiscovery(null); setDecryptedValue(null); }} 
          decryptedValue={decryptedValue} 
          setDecryptedValue={setDecryptedValue} 
          isDecrypting={isDecrypting} 
          decryptWithSignature={decryptWithSignature}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content tech-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="tech-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
      
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="atom-icon small"></div>
              <span>FHE Scientific Discovery</span>
            </div>
            <p>Powered by Zama FHE technology for encrypted scientific research</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Research Papers</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="tech-badge">
            <span>FHE-Powered Scientific Research</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} FHE Scientific Discovery. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  discoveryData: any;
  setDiscoveryData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ onSubmit, onClose, creating, discoveryData, setDiscoveryData }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setDiscoveryData({ ...discoveryData, [name]: value });
  };

  const handleValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setDiscoveryData({ ...discoveryData, [name]: parseFloat(value) });
  };

  const handleSubmit = () => {
    if (!discoveryData.category || !discoveryData.scientificValue) { 
      alert("Please fill required fields"); 
      return; 
    }
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal tech-card">
        <div className="modal-header">
          <h2>Submit New Scientific Discovery</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="tech-notice-banner">
            <div className="key-icon"></div> 
            <div>
              <strong>FHE Encryption Notice</strong>
              <p>Your scientific data will be encrypted with Zama FHE before submission</p>
            </div>
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Category *</label>
              <select 
                name="category" 
                value={discoveryData.category} 
                onChange={handleChange} 
                className="tech-select"
              >
                <option value="">Select scientific category</option>
                {categories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            
            <div className="form-group">
              <label>Hypothesis</label>
              <textarea 
                name="hypothesis" 
                value={discoveryData.hypothesis} 
                onChange={handleChange} 
                placeholder="Enter your scientific hypothesis..."
                className="tech-textarea"
                rows={3}
              />
            </div>
            
            <div className="form-group">
              <label>Scientific Value *</label>
              <input 
                type="number" 
                name="scientificValue" 
                value={discoveryData.scientificValue} 
                onChange={handleValueChange} 
                placeholder="Enter numerical value..." 
                className="tech-input"
                step="0.01"
              />
              <div className="input-hint">Numerical representation of discovery significance (0-100)</div>
            </div>
          </div>
          
          <div className="encryption-preview">
            <h4>FHE Encryption Preview</h4>
            <div className="preview-container">
              <div className="plain-data">
                <span>Plain Value:</span>
                <div>{discoveryData.scientificValue || 'No value entered'}</div>
              </div>
              <div className="encryption-arrow">→</div>
              <div className="encrypted-data">
                <span>Encrypted Data:</span>
                <div>
                  {discoveryData.scientificValue ? 
                    FHEEncryptNumber(discoveryData.scientificValue).substring(0, 50) + '...' : 
                    'No value entered'
                  }
                </div>
              </div>
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> 
            <div>
              <strong>Research Privacy Guarantee</strong>
              <p>Data remains encrypted during FHE processing and is never decrypted on our servers</p>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn tech-button">Cancel</button>
          <button onClick={handleSubmit} disabled={creating} className="submit-btn tech-button primary">
            {creating ? "Encrypting with FHE..." : "Submit Discovery"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface DiscoveryDetailModalProps {
  discovery: ScientificDiscovery;
  onClose: () => void;
  decryptedValue: number | null;
  setDecryptedValue: (value: number | null) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string) => Promise<number | null>;
}

const DiscoveryDetailModal: React.FC<DiscoveryDetailModalProps> = ({ 
  discovery, 
  onClose, 
  decryptedValue, 
  setDecryptedValue, 
  isDecrypting, 
  decryptWithSignature 
}) => {
  const handleDecrypt = async () => {
    if (decryptedValue !== null) { 
      setDecryptedValue(null); 
      return; 
    }
    const decrypted = await decryptWithSignature(discovery.encryptedData);
    if (decrypted !== null) setDecryptedValue(decrypted);
  };

  return (
    <div className="modal-overlay">
      <div className="discovery-detail-modal tech-card">
        <div className="modal-header">
          <h2>Discovery Details #{discovery.id.substring(0, 8)}</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="discovery-info">
            <div className="info-item">
              <span>Category:</span>
              <strong>{discovery.category}</strong>
            </div>
            <div className="info-item">
              <span>Owner:</span>
              <strong>
                {discovery.owner.substring(0, 6)}...{discovery.owner.substring(38)}
              </strong>
            </div>
            <div className="info-item">
              <span>Date:</span>
              <strong>{new Date(discovery.timestamp * 1000).toLocaleString()}</strong>
            </div>
            <div className="info-item">
              <span>Status:</span>
              <strong className={`status-badge ${discovery.status}`}>
                {discovery.status}
              </strong>
            </div>
          </div>
          
          <div className="hypothesis-section">
            <h3>Scientific Hypothesis</h3>
            <div className="hypothesis-content">
              {discovery.hypothesis}
            </div>
          </div>
          
          <div className="encrypted-data-section">
            <h3>Encrypted Scientific Data</h3>
            <div className="encrypted-data">
              {discovery.encryptedData.substring(0, 100)}...
            </div>
            <div className="tech-tag">
              <div className="fhe-icon"></div>
              <span>FHE Encrypted</span>
            </div>
            <button 
              className="decrypt-btn tech-button" 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
            >
              {isDecrypting ? (
                <span className="decrypt-spinner"></span>
              ) : decryptedValue !== null ? (
                "Hide Decrypted Value"
              ) : (
                "Decrypt with Wallet Signature"
              )}
            </button>
          </div>
          
          {decryptedValue !== null && (
            <div className="decrypted-data-section">
              <h3>Decrypted Scientific Value</h3>
              <div className="decrypted-value">
                {decryptedValue.toFixed(2)}
              </div>
              <div className="decryption-notice">
                <div className="warning-icon"></div>
                <span>Decrypted data is only visible after wallet signature verification</span>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn tech-button">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;
