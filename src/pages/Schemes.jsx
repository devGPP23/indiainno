import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';
import './Schemes.css';

const SECTORS = [
    {
        key: 'farming',
        label: 'Farming',
        emoji: '',
        color: '#004B87',
        bg: '#ffffff',
        border: '#cccccc',
        desc: 'PM-KISAN, crop insurance, irrigation & farmer welfare schemes',
    },
    {
        key: 'education',
        label: 'Education',
        emoji: '',
        color: '#004B87',
        bg: '#ffffff',
        border: '#cccccc',
        desc: 'Scholarships, skill development, digital & higher education',
    },
    {
        key: 'financial',
        label: 'Financial',
        emoji: '',
        color: '#004B87',
        bg: '#ffffff',
        border: '#cccccc',
        desc: 'Jan Dhan, MUDRA loans, startup India & MSME support',
    },
    {
        key: 'development',
        label: 'Development',
        emoji: '',
        color: '#004B87',
        bg: '#ffffff',
        border: '#cccccc',
        desc: 'Rural infra, smart cities, roads, housing & water supply',
    },
    {
        key: 'health',
        label: 'Health',
        emoji: '',
        color: '#004B87',
        bg: '#ffffff',
        border: '#cccccc',
        desc: 'Ayushman Bharat, nutrition, wellness & hospital programs',
    },
    {
        key: 'women',
        label: 'Women',
        emoji: '',
        color: '#004B87',
        bg: '#ffffff',
        border: '#cccccc',
        desc: 'Mahila empowerment, Beti Bachao, Ujjwala & SHG schemes',
    },
];

export default function Schemes() {
    const { user, userProfile } = useAuth();
    const navigate = useNavigate();
    const [allData, setAllData] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [activeSector, setActiveSector] = useState(null); // null = sector grid view

    useEffect(() => {
        if (!user) { navigate('/login'); return; }
        fetchSchemes();
    }, [user]);

    const fetchSchemes = async () => {
        setLoading(true);
        setError('');
        try {
            const res = await api.get('/schemes');
            if (res.data.success) {
                setAllData(res.data.data);
            } else {
                setError(res.data.message || 'Failed to load schemes');
            }
        } catch (err) {
            setError(err.response?.data?.message || 'Could not connect to server.');
        }
        setLoading(false);
    };

    const currentSector = SECTORS.find(s => s.key === activeSector);
    const sectorSchemes = allData[activeSector] || [];

    return (
        <div className="schemes-page">
            <div className="schemes-header">
                <div>
                    <h1>Latest Government Schemes</h1>
                    <p>
                        Official announcements for <strong>{userProfile?.city || 'your area'}</strong> &amp; National Schemes
                    </p>
                    <div className="pib-badge">
                        Live from Press Information Bureau — pib.gov.in
                    </div>
                </div>
                <button onClick={fetchSchemes} className="refresh-btn">Refresh</button>
            </div>

            {/* Loading / Error */}
            {loading ? (
                <div className="loading-state">
                    <div className="spinner"></div>
                    <p>Fetching schemes from PIB...</p>
                </div>
            ) : error ? (
                <div className="error-state">
                    <p>{error}</p>
                    <button onClick={fetchSchemes} className="retry-btn">Try Again</button>
                </div>
            ) : activeSector === null ? (
                <div className="sector-grid-view">
                    <p className="sector-hint">Click a category below to view the latest schemes</p>
                    <div className="sector-big-grid">
                        {SECTORS.map(s => (
                            <div
                                key={s.key}
                                className="sector-big-card"
                                onClick={() => setActiveSector(s.key)}
                            >
                                <h2 className="sbc-label">{s.label}</h2>
                                <p className="sbc-desc">{s.desc}</p>
                                <div className="sbc-count">
                                    {allData[s.key]?.length || 0} announcements
                                </div>
                                <div className="sbc-arrow">View Schemes →</div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="drilldown-view">
                    {/* Back + sector title */}
                    <div className="drilldown-header">
                        <button
                            className="back-btn"
                            onClick={() => setActiveSector(null)}
                        >
                            ← Back to Categories
                        </button>
                        <div className="drilldown-title">
                            <div>
                                <h2>{currentSector.label} Schemes</h2>
                                <p>{sectorSchemes.length} announcements from PIB</p>
                            </div>
                        </div>
                    </div>

                    {/* Scheme cards */}
                    {sectorSchemes.length === 0 ? (
                        <div className="empty-state">
                            <p>No recent {currentSector.label} announcements in the latest PIB feed.</p>
                            <p style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
                                Check back later or try refreshing.
                            </p>
                        </div>
                    ) : (
                        <div className="scheme-cards-grid">
                            {sectorSchemes.map((scheme, idx) => (
                                <SchemeCard key={idx} scheme={scheme} sector={currentSector} />
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function SchemeCard({ scheme, sector }) {
    const [expanded, setExpanded] = useState(false);
    const date = scheme.pubDate
        ? new Date(scheme.pubDate).toLocaleDateString('en-IN', {
            day: 'numeric', month: 'short', year: 'numeric'
        })
        : 'Recent';

    return (
        <div className="scheme-card">
            <div className="sc-body">
                <div className="sc-meta">
                    <span className="sc-sector-tag">
                        {sector.label}
                    </span>
                    <span className="sc-date">Date: {date}</span>
                </div>
                <h3 className="sc-title">{scheme.title}</h3>
                {scheme.description && scheme.description !== scheme.title && (
                    <p className={`sc-desc ${expanded ? 'expanded' : ''}`}>
                        {scheme.description}
                    </p>
                )}
                <div className="sc-actions">
                    {scheme.description && scheme.description !== scheme.title && (
                        <button className="sc-expand-btn" onClick={() => setExpanded(!expanded)}>
                            {expanded ? '▲ Show Less' : '▼ Read More'}
                        </button>
                    )}
                    <a
                        href={scheme.link}
                        target="_blank"
                        rel="noreferrer"
                        className="sc-pib-link"
                    >
                        View on PIB →
                    </a>
                </div>
            </div>
        </div>
    );
}
