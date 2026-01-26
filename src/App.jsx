import React, { useState, useCallback, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';

// Default matrix based on the screenshot provided
const defaultMatrix = [
  { id: 1, minCost: 0, maxCost: 1.50, multiplier: 5.00, grossProfit: 80 },
  { id: 2, minCost: 1.51, maxCost: 6.00, multiplier: 4.76, grossProfit: 79 },
  { id: 3, minCost: 6.01, maxCost: 10.00, multiplier: 3.70, grossProfit: 73 },
  { id: 4, minCost: 10.01, maxCost: 30.00, multiplier: 3.33, grossProfit: 70 },
  { id: 5, minCost: 30.01, maxCost: 50.00, multiplier: 2.86, grossProfit: 65 },
  { id: 6, minCost: 50.01, maxCost: 150.00, multiplier: 2.70, grossProfit: 63 },
  { id: 7, minCost: 150.01, maxCost: 250.00, multiplier: 2.50, grossProfit: 60 },
  { id: 8, minCost: 250.01, maxCost: 999999, multiplier: 2.13, grossProfit: 53 },
];

const formatCurrency = (value) => {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
};

const formatPercent = (value) => {
  return `${value.toFixed(1)}%`;
};

// Helper to clean currency strings (e.g. "$1,200.50" -> 1200.50)
const parseCurrency = (str) => {
  if (!str) return 0;
  // Remove everything that isn't a number, decimal point, or minus sign
  const cleanStr = str.toString().replace(/[^0-9.-]+/g, "");
  return parseFloat(cleanStr) || 0;
};

export default function PriceMatrixOptimizer() {
  // --- SECURITY: TRIAL MODE SWITCH ---
  // Set this to TRUE before sending the sample link.
  // Set this to FALSE after you receive payment.
  const IS_TRIAL_MODE = true;

  const [step, setStep] = useState(1);
  
  // Initialize matrix from localStorage or use default
  const [matrix, setMatrix] = useState(() => {
    try {
      const savedMatrix = localStorage.getItem('priceMatrix');
      if (savedMatrix) {
        const parsed = JSON.parse(savedMatrix);
        // Validate it's an array with expected structure
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].minCost !== undefined) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Could not load saved matrix:', e);
    }
    return defaultMatrix;
  });
  const [partsData, setPartsData] = useState([]);
  const [tierAnalysis, setTierAnalysis] = useState([]);
  const [targetIncrease, setTargetIncrease] = useState(5);
  const [targetType, setTargetType] = useState('percent');
  const [recommendations, setRecommendations] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [skippedCount, setSkippedCount] = useState(0);

  // Save matrix to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem('priceMatrix', JSON.stringify(matrix));
    } catch (e) {
      console.warn('Could not save matrix to localStorage:', e);
    }
  }, [matrix]);

  // Add a new tier to the matrix
  const addTier = () => {
    if (matrix.length >= 10) return;
    const lastTier = matrix[matrix.length - 1];
    const newTier = {
      id: matrix.length + 1,
      minCost: lastTier.maxCost === 999999 ? lastTier.minCost + 100 : lastTier.maxCost + 0.01,
      maxCost: 999999,
      multiplier: 2.0,
      grossProfit: 50
    };
    // Update the previous last tier's max
    const updatedMatrix = matrix.map((tier, idx) => {
      if (idx === matrix.length - 1) {
        return { ...tier, maxCost: newTier.minCost - 0.01 };
      }
      return tier;
    });
    setMatrix([...updatedMatrix, newTier]);
  };

  // Remove a tier
  const removeTier = (id) => {
    if (matrix.length <= 2) return;
    setMatrix(matrix.filter(t => t.id !== id).map((t, idx) => ({ ...t, id: idx + 1 })));
  };

  // Update a tier's values
  const updateTier = (id, field, value) => {
    setMatrix(matrix.map(tier => {
      if (tier.id === id) {
        const updated = { ...tier, [field]: parseFloat(value) || 0 };
        // Auto-calculate multiplier from gross profit or vice versa
        if (field === 'grossProfit') {
          updated.multiplier = 100 / (100 - updated.grossProfit);
        } else if (field === 'multiplier') {
          updated.grossProfit = 100 - (100 / updated.multiplier);
        }
        return updated;
      }
      return tier;
    }));
  };

  // Parse CSV file
  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setFileName(file.name);
    setError('');

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const lines = text.split('\n').filter(line => line.trim());

        // --- HEADER SCANNER: Find the actual header row (may not be line 1) ---
        let headerRowIndex = -1;
        let headers = [];

        for (let i = 0; i < Math.min(lines.length, 10); i++) {
          const row = lines[i].toLowerCase();
          // Look for keywords that indicate this is the header row
          if (row.includes('cost') || row.includes('price') || row.includes('qty') || row.includes('total')) {
            headerRowIndex = i;
            headers = lines[i].split(',').map(h => h.trim().toLowerCase());
            break;
          }
        }

        if (headerRowIndex === -1) {
          setError('Could not find a valid header row (looking for "Cost", "Price", or "Qty"). Please check your CSV.');
          return;
        }

        // Find relevant columns (improved to handle "Buy Price" variations)
        const costIdx = headers.findIndex(h => h.includes('unit cost') || h.includes('buy price') || h === 'cost' || h === 'unitcost');
        const retailIdx = headers.findIndex(h => h.includes('unit retail') || h.includes('sell price') || h === 'retail' || h === 'unitretail' || h === 'price');
        const qtyIdx = headers.findIndex(h => h.includes('qty') || h === 'quantity' || h === 'sold');
        const totalCostIdx = headers.findIndex(h => h.includes('total cost') || h.includes('ext cost'));
        const totalRetailIdx = headers.findIndex(h => h.includes('total retail') || h.includes('ext price') || h.includes('ext revenue') || h.includes('amount') || h.includes('revenue'));

        if (costIdx === -1) {
          setError('Could not find a "Unit Cost" or "Buy Price" column in the CSV. Please ensure your file has cost data.');
          return;
        }

        const parts = [];
        let skippedRows = 0;

        // Start parsing from line AFTER the header row
        for (let i = headerRowIndex + 1; i < lines.length; i++) {
          // ROBUST CSV PARSER: Handles quoted fields, empty fields (,,), and special characters
          const cleanRow = [];
          let currentField = '';
          let insideQuotes = false;
          const line = lines[i];

          for (let j = 0; j < line.length; j++) {
            const char = line[j];
            const nextChar = line[j + 1];

            if (char === '"') {
              // Handle escaped quotes ("")
              if (insideQuotes && nextChar === '"') {
                currentField += '"';
                j++; // Skip next quote
              } else {
                insideQuotes = !insideQuotes;
              }
            } else if (char === ',' && !insideQuotes) {
              // End of field
              cleanRow.push(currentField.trim());
              currentField = '';
            } else {
              currentField += char;
            }
          }

          // Push the last field
          cleanRow.push(currentField.trim());

          // Skip completely empty rows
          if (cleanRow.length === 0 || cleanRow.every(cell => !cell)) {
            skippedRows++;
            continue;
          }

          // Validate row has minimum required columns
          const requiredColumns = Math.max(costIdx, retailIdx !== -1 ? retailIdx : 0, qtyIdx !== -1 ? qtyIdx : 0, totalCostIdx !== -1 ? totalCostIdx : 0, totalRetailIdx !== -1 ? totalRetailIdx : 0) + 1;

          if (cleanRow.length < requiredColumns) {
            skippedRows++;
            continue;
          }
          
          // Use parseCurrency to handle "$1,234.56" formatted values
          const unitCost = parseCurrency(cleanRow[costIdx]);
          const unitRetail = retailIdx !== -1 ? parseCurrency(cleanRow[retailIdx]) : 0;
          const qty = qtyIdx !== -1 ? parseCurrency(cleanRow[qtyIdx]) : 1;

          // SELF-HEALING LOGIC WITH VALIDATION: Check if parsed value is valid and reasonable
          const csvTotalCost = totalCostIdx !== -1 ? parseCurrency(cleanRow[totalCostIdx]) : 0;
          const calculatedTotalCost = unitCost * qty;

          // Validate: If CSV total differs significantly from calculated (>50%), use calculated
          let totalCost = calculatedTotalCost;
          if (csvTotalCost > 0.01) {
            const difference = Math.abs(csvTotalCost - calculatedTotalCost) / calculatedTotalCost;
            if (difference < 0.5) {
              // CSV total is close to calculated, trust it (allows for rounding/discounts)
              totalCost = csvTotalCost;
            }
            // Otherwise use calculated value (CSV data is likely garbage)
          }

          const csvTotalRetail = totalRetailIdx !== -1 ? parseCurrency(cleanRow[totalRetailIdx]) : 0;
          const calculatedTotalRetail = unitRetail * qty;

          // Same validation for retail
          let totalRetail = calculatedTotalRetail;
          if (csvTotalRetail > 0.01) {
            const difference = Math.abs(csvTotalRetail - calculatedTotalRetail) / calculatedTotalRetail;
            if (difference < 0.5) {
              totalRetail = csvTotalRetail;
            }
          }

          // Skip zero-cost items (warranties, supplies)
          if (unitCost > 0) {
            parts.push({ unitCost, unitRetail, qty, totalCost, totalRetail });
          } else {
            skippedRows++;
          }
        }
        
        if (parts.length === 0) {
          setError('No valid parts data found. Please check your CSV format. Make sure you have a "Unit Cost" column with numeric values.');
          return;
        }
        
        // Update the skipped count state
        setSkippedCount(skippedRows);

        if (skippedRows > 0) {
          console.warn(`Skipped ${skippedRows} invalid rows`);
        }

        setPartsData(parts);
        analyzeTiers(parts);
      } catch (err) {
        console.error('CSV parsing error:', err);
        setError('Error parsing CSV file. Please ensure it is properly formatted. Tip: Try re-exporting from your POS system.');
      }
    };
    reader.readAsText(file);
  };

  // Analyze parts by tier
  const analyzeTiers = useCallback((parts) => {
    const analysis = matrix.map(tier => {
      const tierParts = parts.filter(p => p.unitCost >= tier.minCost && p.unitCost <= tier.maxCost);
      const totalCost = tierParts.reduce((sum, p) => sum + p.totalCost, 0);
      const totalRetail = tierParts.reduce((sum, p) => sum + p.totalRetail, 0);
      const totalQty = tierParts.reduce((sum, p) => sum + p.qty, 0);
      const currentMargin = totalRetail > 0 ? ((totalRetail - totalCost) / totalRetail) * 100 : 0;
      const currentProfit = totalRetail - totalCost;
      
      return {
        ...tier,
        partCount: tierParts.length,
        totalQty,
        totalCost,
        totalRetail,
        currentMargin,
        currentProfit,
        revenueShare: 0 // Will be calculated after
      };
    });
    
    const totalRevenue = analysis.reduce((sum, t) => sum + t.totalRetail, 0);
    analysis.forEach(tier => {
      tier.revenueShare = totalRevenue > 0 ? (tier.totalRetail / totalRevenue) * 100 : 0;
    });
    
    setTierAnalysis(analysis);
  }, [matrix]);

  // Calculate optimization recommendations
  const calculateRecommendations = async () => {
    setIsAnalyzing(true);

    // Calculate current totals
    const currentTotalProfit = tierAnalysis.reduce((sum, t) => sum + t.currentProfit, 0);
    const currentTotalRevenue = tierAnalysis.reduce((sum, t) => sum + t.totalRetail, 0);
    const currentTotalCost = tierAnalysis.reduce((sum, t) => sum + t.totalCost, 0);

    // Calculate target profit
    let targetProfit;
    if (targetType === 'percent') {
      // Percentage increase in profit
      targetProfit = currentTotalProfit * (1 + targetIncrease / 100);
    } else if (targetType === 'margin') {
      // Target margin percentage (e.g., "I want 50% margin")
      const targetMarginDecimal = targetIncrease / 100;
      const targetRevenue = currentTotalCost / (1 - targetMarginDecimal);
      targetProfit = targetRevenue - currentTotalCost;
    } else {
      // Dollar amount increase
      targetProfit = currentTotalProfit + targetIncrease;
    }

    const profitGap = targetProfit - currentTotalProfit;

    // FIXED ALGORITHM: Work with ACTUAL current multipliers, not matrix multipliers
    // Calculate the actual current overall multiplier from real data
    const currentActualOverallMultiplier = currentTotalCost > 0 ? (currentTotalRevenue / currentTotalCost) : 1;
    const targetOverallMultiplier = currentTotalCost > 0 ? (targetProfit / currentTotalCost) + 1 : 1;
    const multiplierIncreaseRatio = targetOverallMultiplier / currentActualOverallMultiplier;

    console.log('DEBUG - Algorithm:', {
      currentProfit: currentTotalProfit,
      targetProfit,
      currentActualOverallMultiplier,
      targetOverallMultiplier,
      multiplierIncreaseRatio
    });

    // Distribute increases intelligently across tiers
    const optimizedTiers = tierAnalysis.map(tier => {
      if (tier.totalCost <= 0 || tier.totalRetail <= 0) {
        return {
          ...tier,
          newMultiplier: tier.multiplier,
          newGrossProfit: tier.grossProfit,
          multiplierChange: 0,
          marginChange: 0,
          projectedProfit: 0,
          impactScore: 0
        };
      }

      // Calculate ACTUAL current multiplier for this tier (not matrix multiplier)
      const currentActualMultiplier = tier.totalRetail / tier.totalCost;
      const currentActualMargin = ((tier.totalRetail - tier.totalCost) / tier.totalRetail) * 100;

      // Weight factors: Equal weighting for volume and headroom (50/50)
      const volumeWeight = tier.revenueShare / 100;
      const headroomWeight = 1 - (currentActualMargin / 100); // Lower ACTUAL margin = more headroom
      const combinedWeight = (volumeWeight * 0.5) + (headroomWeight * 0.5);

      // Calculate how much to increase THIS tier's ACTUAL multiplier
      const baseIncrease = (multiplierIncreaseRatio - 1);
      const weightedIncrease = baseIncrease * (0.5 + combinedWeight);

      // Calculate new ACTUAL multiplier (not matrix multiplier)
      let newActualMultiplier = currentActualMultiplier * (1 + weightedIncrease);

      // Safety caps: Allow up to 3x increase from CURRENT ACTUAL
      newActualMultiplier = Math.min(newActualMultiplier, currentActualMultiplier * 3);
      newActualMultiplier = Math.max(newActualMultiplier, currentActualMultiplier); // Never decrease

      // Calculate new gross profit % from new ACTUAL multiplier
      let newGrossProfit = 100 - (100 / newActualMultiplier);
      newGrossProfit = Math.min(newGrossProfit, 95); // Cap at 95% margin

      // Recalculate multiplier from capped gross profit if needed
      if (newGrossProfit >= 95) {
        newActualMultiplier = 100 / (100 - 95);
      }

      // Calculate projected revenue and profit
      const projectedRevenue = tier.totalCost * newActualMultiplier;
      const projectedProfit = projectedRevenue - tier.totalCost;

      // For display: Calculate what the NEW matrix multiplier should be
      const newMatrixMultiplier = newActualMultiplier; // Recommendation is to update matrix to match new pricing

      const multiplierChange = newMatrixMultiplier - tier.multiplier;
      const marginChange = newGrossProfit - tier.grossProfit;

      return {
        ...tier,
        newMultiplier: Math.round(newMatrixMultiplier * 100) / 100,
        newGrossProfit: Math.round(newGrossProfit * 10) / 10,
        multiplierChange: Math.round(multiplierChange * 100) / 100,
        marginChange: Math.round(marginChange * 10) / 10,
        projectedProfit: Math.round(projectedProfit * 100) / 100,
        impactScore: Math.abs(marginChange) * (tier.revenueShare / 100)
      };
    });
    
    const projectedTotalProfit = optimizedTiers.reduce((sum, t) => sum + t.projectedProfit, 0);
    
    setRecommendations({
      currentProfit: currentTotalProfit,
      targetProfit,
      projectedProfit: projectedTotalProfit,
      profitIncrease: projectedTotalProfit - currentTotalProfit,
      percentIncrease: ((projectedTotalProfit - currentTotalProfit) / currentTotalProfit) * 100,
      tiers: optimizedTiers,
      currentRevenue: currentTotalRevenue,
      currentCost: currentTotalCost
    });
    
    setIsAnalyzing(false);
    setStep(4);
  };

  // Chart colors
  const COLORS = ['#0ea5e9', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16'];

  // Export as CSV
  const exportCSV = () => {
    if (IS_TRIAL_MODE) {
      alert("🔒 DEMO MODE ACTIVE\n\nPlease contact the developer to unlock the full Export functionality.");
      return;
    }

    if (!recommendations) return;

    const headers = ['Min Cost', 'Max Cost', 'Current Multiplier', 'New Multiplier', 'Current GP%', 'New GP%', 'Change'];
    const rows = recommendations.tiers.map(tier => [
      tier.minCost.toFixed(2),
      tier.maxCost === 999999 ? 'Maximum' : tier.maxCost.toFixed(2),
      tier.multiplier.toFixed(2),
      tier.newMultiplier.toFixed(2),
      tier.grossProfit.toFixed(1),
      tier.newGrossProfit.toFixed(1),
      tier.multiplierChange > 0 ? `+${tier.multiplierChange.toFixed(2)}` : tier.multiplierChange.toFixed(2)
    ]);
    
    const csvContent = [
      '# Price Matrix Optimization Report',
      `# Generated: ${new Date().toLocaleDateString()}`,
      `# Current Profit: ${formatCurrency(recommendations.currentProfit)}`,
      `# Projected Profit: ${formatCurrency(recommendations.projectedProfit)}`,
      `# Increase: ${formatPercent(recommendations.percentIncrease)}`,
      '',
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `price-matrix-optimized-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Export as formatted text report (for printing/PDF)
  const exportReport = () => {
    if (IS_TRIAL_MODE) {
      alert("🔒 DEMO MODE ACTIVE\n\nPlease contact the developer to unlock the full Export functionality.");
      return;
    }

    if (!recommendations) return;

    const report = `
════════════════════════════════════════════════════════════════
                    PRICE MATRIX OPTIMIZATION REPORT
════════════════════════════════════════════════════════════════

Generated: ${new Date().toLocaleString()}
Data Source: ${fileName || 'Uploaded CSV'}
Parts Analyzed: ${partsData.length}

────────────────────────────────────────────────────────────────
                         FINANCIAL SUMMARY
────────────────────────────────────────────────────────────────

  Current Profit:     ${formatCurrency(recommendations.currentProfit).padStart(12)}
  Target Profit:      ${formatCurrency(recommendations.targetProfit).padStart(12)}
  Projected Profit:   ${formatCurrency(recommendations.projectedProfit).padStart(12)}
  ─────────────────────────────────────
  Profit Increase:    ${formatCurrency(recommendations.profitIncrease).padStart(12)}  (+${formatPercent(recommendations.percentIncrease)})

────────────────────────────────────────────────────────────────
                    RECOMMENDED MATRIX CHANGES
────────────────────────────────────────────────────────────────

${recommendations.tiers.map(tier => `
  Cost Range: $${tier.minCost.toFixed(2)} - ${tier.maxCost === 999999 ? 'Maximum' : '$' + tier.maxCost.toFixed(2)}
  ├─ Current:     ${tier.multiplier.toFixed(2)}x  (${tier.grossProfit.toFixed(1)}% GP)
  ├─ Recommended: ${tier.newMultiplier.toFixed(2)}x  (${tier.newGrossProfit.toFixed(1)}% GP)
  ├─ Change:      ${tier.multiplierChange > 0 ? '+' : ''}${tier.multiplierChange.toFixed(2)}x
  └─ Parts in tier: ${tier.partCount} (${tier.revenueShare.toFixed(1)}% of revenue)
`).join('')}
────────────────────────────────────────────────────────────────
                      QUICK REFERENCE TABLE
────────────────────────────────────────────────────────────────

  COST RANGE              MULTIPLIER    GROSS PROFIT %
  ─────────────────────────────────────────────────────
${recommendations.tiers.map(tier => 
  `  $${tier.minCost.toFixed(2).padEnd(8)} - ${(tier.maxCost === 999999 ? 'Max' : '$' + tier.maxCost.toFixed(2)).padEnd(10)}    ${tier.newMultiplier.toFixed(2)}x          ${tier.newGrossProfit.toFixed(1)}%`
).join('\n')}

════════════════════════════════════════════════════════════════
  Copy the values above directly into your POS price matrix.
════════════════════════════════════════════════════════════════
`;

    const blob = new Blob([report], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `price-matrix-report-${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Copy to clipboard function
  const copyToClipboard = () => {
    if (IS_TRIAL_MODE) {
      alert("🔒 DEMO MODE ACTIVE\n\nPlease contact the developer to unlock the Copy functionality.");
      return;
    }

    if (!recommendations) return;

    const tableText = recommendations.tiers.map(tier =>
      `$${tier.minCost.toFixed(2)}-${tier.maxCost === 999999 ? 'Max' : '$' + tier.maxCost.toFixed(2)}\t${tier.newMultiplier.toFixed(2)}\t${tier.newGrossProfit.toFixed(1)}%`
    ).join('\n');

    const header = 'Cost Range\tMultiplier\tGross Profit %\n';
    navigator.clipboard.writeText(header + tableText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const [copied, setCopied] = useState(false);

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 md:p-8 font-sans">
      {/* Header */}
      <div className="max-w-6xl mx-auto mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 bg-gradient-to-br from-emerald-400 to-cyan-500 rounded-lg flex items-center justify-center">
            <svg className="w-6 h-6 text-slate-950" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
              Price Matrix Optimizer
            </h1>
            <p className="text-slate-400 text-sm">Intelligent markup optimization for auto parts</p>
          </div>
        </div>
        
        {/* Progress Steps */}
        <div className="flex items-center gap-2 mt-6 overflow-x-auto pb-2">
          {['Matrix Setup', 'Upload Data', 'Set Target', 'Results'].map((label, idx) => (
            <div key={idx} className="flex items-center">
              <button
                onClick={() => idx < step && setStep(idx + 1)}
                className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all ${
                  step === idx + 1
                    ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/50'
                    : step > idx + 1
                    ? 'bg-slate-800 text-slate-300 hover:bg-slate-700 cursor-pointer'
                    : 'bg-slate-900 text-slate-600 cursor-not-allowed'
                }`}
              >
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                  step > idx + 1 ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800'
                }`}>
                  {step > idx + 1 ? '✓' : idx + 1}
                </span>
                <span className="whitespace-nowrap">{label}</span>
              </button>
              {idx < 3 && <div className={`w-8 h-0.5 mx-1 ${step > idx + 1 ? 'bg-emerald-500' : 'bg-slate-800'}`} />}
            </div>
          ))}
        </div>
      </div>

      <div className="max-w-6xl mx-auto">
        {/* Step 1: Matrix Setup */}
        {step === 1 && (
          <div className="space-y-6">
            <div className="bg-slate-900 rounded-2xl p-6 border border-slate-800">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-white">Your Price Matrix</h2>
                  <p className="text-slate-500 text-xs flex items-center gap-1 mt-1">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    Auto-saved to browser
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      if (window.confirm('Reset matrix to default values? This cannot be undone.')) {
                        setMatrix(defaultMatrix);
                      }
                    }}
                    className="flex items-center gap-2 px-3 py-2 bg-slate-800 text-slate-400 rounded-lg hover:bg-slate-700 hover:text-slate-300 transition-colors text-sm"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Reset
                  </button>
                  <button
                    onClick={addTier}
                    disabled={matrix.length >= 10}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-500/20 text-emerald-400 rounded-lg hover:bg-emerald-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span>+</span> Add Tier
                  </button>
                </div>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-slate-400 text-sm">
                      <th className="text-left pb-3 px-2">Cost Range</th>
                      <th className="text-center pb-3 px-2">Multiplier</th>
                      <th className="text-center pb-3 px-2">Gross Profit %</th>
                      <th className="text-center pb-3 px-2">Markup %</th>
                      <th className="w-12"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {matrix.map((tier, idx) => (
                      <tr key={tier.id} className="border-t border-slate-800">
                        <td className="py-3 px-2">
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              value={tier.minCost}
                              onChange={(e) => updateTier(tier.id, 'minCost', e.target.value)}
                              className="w-24 bg-slate-800 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-emerald-500 outline-none"
                              step="0.01"
                            />
                            <span className="text-slate-500">to</span>
                            <input
                              type="number"
                              value={tier.maxCost === 999999 ? '' : tier.maxCost}
                              placeholder="Max"
                              onChange={(e) => updateTier(tier.id, 'maxCost', e.target.value || 999999)}
                              className="w-24 bg-slate-800 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-emerald-500 outline-none"
                              step="0.01"
                            />
                          </div>
                        </td>
                        <td className="py-3 px-2">
                          <input
                            type="number"
                            value={tier.multiplier}
                            onChange={(e) => updateTier(tier.id, 'multiplier', e.target.value)}
                            className="w-20 bg-slate-800 rounded-lg px-3 py-2 text-white text-center focus:ring-2 focus:ring-emerald-500 outline-none"
                            step="0.01"
                          />
                        </td>
                        <td className="py-3 px-2">
                          <div className="flex items-center justify-center gap-1">
                            <input
                              type="number"
                              value={Math.round(tier.grossProfit * 10) / 10}
                              onChange={(e) => updateTier(tier.id, 'grossProfit', e.target.value)}
                              className="w-20 bg-slate-800 rounded-lg px-3 py-2 text-white text-center focus:ring-2 focus:ring-emerald-500 outline-none"
                              step="0.1"
                            />
                            <span className="text-slate-500">%</span>
                          </div>
                        </td>
                        <td className="py-3 px-2 text-center">
                          <span className="text-cyan-400 font-medium">
                            {((tier.multiplier - 1) * 100).toFixed(1)}%
                          </span>
                        </td>
                        <td className="py-3 px-2">
                          <button
                            onClick={() => removeTier(tier.id)}
                            disabled={matrix.length <= 2}
                            className="p-2 text-slate-500 hover:text-red-400 transition-colors disabled:opacity-30"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              <p className="text-slate-500 text-sm mt-4">
                Tip: Edit the Gross Profit % and the Multiplier will auto-calculate, or vice versa. Your matrix is automatically saved and will persist even if you close the browser.
              </p>
            </div>
            
            <button
              onClick={() => setStep(2)}
              className="w-full py-4 bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 font-semibold rounded-xl hover:opacity-90 transition-opacity"
            >
              Continue to Upload Data →
            </button>
          </div>
        )}

        {/* Step 2: Upload Data */}
        {step === 2 && (
          <div className="space-y-6">
            <div className="bg-slate-900 rounded-2xl p-8 border border-slate-800 border-dashed">
              <div className="text-center">
                <div className="w-16 h-16 bg-slate-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                <h2 className="text-lg font-semibold text-white mb-2">Upload Parts Sales Data</h2>
                <p className="text-slate-400 text-sm mb-6">
                  Upload a CSV file with your parts sales data. Must include a "Unit Cost" column.<br/>
                  <span className="text-slate-500">Supports formatted values like $1,234.56</span>
                </p>
                
                <label className="inline-block">
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <span className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-500/20 text-emerald-400 rounded-xl hover:bg-emerald-500/30 transition-colors cursor-pointer font-medium">
                    Choose CSV File
                  </span>
                </label>
                
                {fileName && (
                  <div className="mt-4 flex items-center justify-center gap-2 text-emerald-400">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>{fileName}</span>
                    <span className="text-slate-500">({partsData.length} parts loaded)</span>
                  </div>
                )}

                {/* Add this Warning Block */}
                {skippedCount > 0 && (
                  <div className="mt-2 text-amber-400 text-sm bg-amber-500/10 px-3 py-2 rounded-lg border border-amber-500/20 flex items-center justify-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    <span>Warning: {skippedCount} rows were skipped due to formatting errors.</span>
                  </div>
                )}
                
                {error && (
                  <div className="mt-4 p-4 bg-red-500/20 text-red-400 rounded-xl">
                    {error}
                  </div>
                )}
              </div>
            </div>
            
            {/* Tier Analysis Preview */}
            {tierAnalysis.length > 0 && tierAnalysis.some(t => t.partCount > 0) && (
              <div className="bg-slate-900 rounded-2xl p-6 border border-slate-800">
                <h3 className="text-lg font-semibold text-white mb-4">Parts Distribution by Tier</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={tierAnalysis.filter(t => t.partCount > 0)}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis 
                        dataKey="id" 
                        stroke="#64748b"
                        tickFormatter={(id) => {
                          const tier = tierAnalysis.find(t => t.id === id);
                          return tier ? `$${tier.minCost}-${tier.maxCost === 999999 ? '+' : tier.maxCost}` : '';
                        }}
                      />
                      <YAxis stroke="#64748b" />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '0.5rem' }}
                        labelFormatter={(id) => {
                          const tier = tierAnalysis.find(t => t.id === id);
                          return tier ? `Cost Range: $${tier.minCost} - $${tier.maxCost === 999999 ? 'Maximum' : tier.maxCost}` : '';
                        }}
                      />
                      <Bar dataKey="partCount" name="Parts Count" radius={[4, 4, 0, 0]}>
                        {tierAnalysis.filter(t => t.partCount > 0).map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
                  <div className="bg-slate-800 rounded-xl p-4">
                    <div className="text-slate-400 text-sm">Total Parts</div>
                    <div className="text-2xl font-bold text-white">{partsData.length}</div>
                  </div>
                  <div className="bg-slate-800 rounded-xl p-4">
                    <div className="text-slate-400 text-sm">Total Cost</div>
                    <div className="text-2xl font-bold text-white">
                      {formatCurrency(tierAnalysis.reduce((sum, t) => sum + t.totalCost, 0))}
                    </div>
                  </div>
                  <div className="bg-slate-800 rounded-xl p-4">
                    <div className="text-slate-400 text-sm">Total Revenue</div>
                    <div className="text-2xl font-bold text-white">
                      {formatCurrency(tierAnalysis.reduce((sum, t) => sum + t.totalRetail, 0))}
                    </div>
                  </div>
                  <div className="bg-slate-800 rounded-xl p-4">
                    <div className="text-slate-400 text-sm">Current Profit</div>
                    <div className="text-2xl font-bold text-emerald-400">
                      {formatCurrency(tierAnalysis.reduce((sum, t) => sum + t.currentProfit, 0))}
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            <div className="flex gap-4">
              <button
                onClick={() => setStep(1)}
                className="px-6 py-4 bg-slate-800 text-white font-semibold rounded-xl hover:bg-slate-700 transition-colors"
              >
                ← Back
              </button>
              <button
                onClick={() => setStep(3)}
                disabled={partsData.length === 0}
                className="flex-1 py-4 bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 font-semibold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continue to Set Target →
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Set Target */}
        {step === 3 && (
          <div className="space-y-6">
            <div className="bg-slate-900 rounded-2xl p-6 border border-slate-800">
              <h2 className="text-lg font-semibold text-white mb-6">Set Your Margin Target</h2>
              
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-slate-400 text-sm mb-2">Target Type</label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => setTargetType('percent')}
                      className={`py-3 px-3 rounded-xl font-medium transition-all text-sm ${
                        targetType === 'percent'
                          ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/50'
                          : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                      }`}
                    >
                      % Growth
                    </button>
                    <button
                      onClick={() => setTargetType('margin')}
                      className={`py-3 px-3 rounded-xl font-medium transition-all text-sm ${
                        targetType === 'margin'
                          ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/50'
                          : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                      }`}
                    >
                      Target Margin
                    </button>
                    <button
                      onClick={() => setTargetType('dollar')}
                      className={`py-3 px-3 rounded-xl font-medium transition-all text-sm ${
                        targetType === 'dollar'
                          ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/50'
                          : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                      }`}
                    >
                      $ Amount
                    </button>
                  </div>
                </div>
                
                <div>
                  <label className="block text-slate-400 text-sm mb-2">
                    {targetType === 'percent' ? 'Profit Increase %' : targetType === 'margin' ? 'Target Margin %' : 'Additional Profit $'}
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">
                      {targetType === 'dollar' ? '$' : ''}
                    </span>
                    <input
                      type="number"
                      value={targetIncrease}
                      onChange={(e) => setTargetIncrease(parseFloat(e.target.value) || 0)}
                      className={`w-full bg-slate-800 rounded-xl py-3 text-white text-xl font-bold focus:ring-2 focus:ring-emerald-500 outline-none ${
                        targetType === 'dollar' ? 'pl-8 pr-4' : 'px-4'
                      }`}
                    />
                    {(targetType === 'percent' || targetType === 'margin') && (
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500">%</span>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="mt-6 p-4 bg-slate-800 rounded-xl">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Current Profit:</span>
                  <span className="text-white font-semibold">
                    {formatCurrency(tierAnalysis.reduce((sum, t) => sum + t.currentProfit, 0))}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-slate-400 text-sm">Current Margin:</span>
                  <span className="text-cyan-400 font-semibold text-sm">
                    {(() => {
                      const currentProfit = tierAnalysis.reduce((sum, t) => sum + t.currentProfit, 0);
                      const currentRevenue = tierAnalysis.reduce((sum, t) => sum + t.totalRetail, 0);
                      const currentMargin = currentRevenue > 0 ? (currentProfit / currentRevenue * 100) : 0;
                      return `${currentMargin.toFixed(1)}%`;
                    })()}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-slate-400">Target Profit:</span>
                  <span className="text-emerald-400 font-semibold">
                    {formatCurrency(
                      (() => {
                        const currentProfit = tierAnalysis.reduce((sum, t) => sum + t.currentProfit, 0);
                        const currentCost = tierAnalysis.reduce((sum, t) => sum + t.totalCost, 0);
                        if (targetType === 'percent') {
                          return currentProfit * (1 + targetIncrease / 100);
                        } else if (targetType === 'margin') {
                          const targetMarginDecimal = targetIncrease / 100;
                          const targetRevenue = currentCost / (1 - targetMarginDecimal);
                          return targetRevenue - currentCost;
                        } else {
                          return currentProfit + targetIncrease;
                        }
                      })()
                    )}
                  </span>
                </div>
              </div>
            </div>
            
            <div className="flex gap-4">
              <button
                onClick={() => setStep(2)}
                className="px-6 py-4 bg-slate-800 text-white font-semibold rounded-xl hover:bg-slate-700 transition-colors"
              >
                ← Back
              </button>
              <button
                onClick={calculateRecommendations}
                disabled={isAnalyzing}
                className="flex-1 py-4 bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 font-semibold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {isAnalyzing ? 'Analyzing...' : 'Generate Recommendations →'}
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Results */}
        {step === 4 && recommendations && (
          <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-slate-900 rounded-2xl p-5 border border-slate-800">
                <div className="text-slate-400 text-sm">Current Profit</div>
                <div className="text-2xl font-bold text-white mt-1">
                  {formatCurrency(recommendations.currentProfit)}
                </div>
              </div>
              <div className="bg-slate-900 rounded-2xl p-5 border border-slate-800">
                <div className="text-slate-400 text-sm">Target Profit</div>
                <div className="text-2xl font-bold text-cyan-400 mt-1">
                  {formatCurrency(recommendations.targetProfit)}
                </div>
              </div>
              <div className="bg-slate-900 rounded-2xl p-5 border border-slate-800">
                <div className="text-slate-400 text-sm">Projected Profit</div>
                <div className="text-2xl font-bold text-emerald-400 mt-1">
                  {formatCurrency(recommendations.projectedProfit)}
                </div>
              </div>
              <div className="bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 rounded-2xl p-5 border border-emerald-500/30">
                <div className="text-emerald-300 text-sm">Profit Increase</div>
                <div className="text-2xl font-bold text-emerald-400 mt-1">
                  +{formatPercent(recommendations.percentIncrease)}
                </div>
              </div>
            </div>

            {/* Recommended Matrix */}
            <div className="bg-slate-900 rounded-2xl p-6 border border-slate-800">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white">Recommended Matrix Adjustments</h2>
                <div className="flex gap-2">
                  <button
                    onClick={copyToClipboard}
                    className="flex items-center gap-2 px-3 py-2 bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700 transition-colors text-sm"
                  >
                    {copied ? (
                      <>
                        <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Copied!
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        Copy
                      </>
                    )}
                  </button>
                </div>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-slate-400 text-sm border-b border-slate-800">
                      <th className="text-left pb-3 px-2">Cost Range</th>
                      <th className="text-center pb-3 px-2">Current Mult.</th>
                      <th className="text-center pb-3 px-2">New Mult.</th>
                      <th className="text-center pb-3 px-2">Change</th>
                      <th className="text-center pb-3 px-2">Current GP%</th>
                      <th className="text-center pb-3 px-2">New GP%</th>
                      <th className="text-center pb-3 px-2">Parts</th>
                      <th className="text-center pb-3 px-2">Revenue Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recommendations.tiers.map((tier, idx) => (
                      <tr key={tier.id} className="border-t border-slate-800">
                        <td className="py-3 px-2">
                          <span className="inline-flex items-center gap-2">
                            <span 
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                            />
                            ${tier.minCost.toFixed(2)} - {tier.maxCost === 999999 ? 'Max' : `$${tier.maxCost.toFixed(2)}`}
                          </span>
                        </td>
                        <td className="py-3 px-2 text-center text-slate-400">
                          {tier.multiplier.toFixed(2)}x
                        </td>
                        <td className="py-3 px-2 text-center font-semibold text-white">
                          {tier.newMultiplier.toFixed(2)}x
                        </td>
                        <td className="py-3 px-2 text-center">
                          {tier.multiplierChange > 0 ? (
                            <span className="text-emerald-400">+{tier.multiplierChange.toFixed(2)}</span>
                          ) : tier.multiplierChange < 0 ? (
                            <span className="text-red-400">{tier.multiplierChange.toFixed(2)}</span>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </td>
                        <td className="py-3 px-2 text-center text-slate-400">
                          {tier.grossProfit.toFixed(1)}%
                        </td>
                        <td className="py-3 px-2 text-center font-semibold text-white">
                          {tier.newGrossProfit.toFixed(1)}%
                        </td>
                        <td className="py-3 px-2 text-center text-slate-400">
                          {tier.partCount}
                        </td>
                        <td className="py-3 px-2 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <div className="w-16 bg-slate-800 rounded-full h-2 overflow-hidden">
                              <div 
                                className="h-full rounded-full"
                                style={{ 
                                  width: `${tier.revenueShare}%`,
                                  backgroundColor: COLORS[idx % COLORS.length]
                                }}
                              />
                            </div>
                            <span className="text-slate-400 text-sm">{tier.revenueShare.toFixed(1)}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Visual Comparison */}
            <div className="bg-slate-900 rounded-2xl p-6 border border-slate-800">
              <h3 className="text-lg font-semibold text-white mb-4">Multiplier Comparison</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart 
                    data={recommendations.tiers.filter(t => t.partCount > 0)}
                    layout="vertical"
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis type="number" stroke="#64748b" domain={[0, 'auto']} />
                    <YAxis 
                      type="category" 
                      dataKey="id" 
                      stroke="#64748b"
                      width={100}
                      tickFormatter={(id) => {
                        const tier = recommendations.tiers.find(t => t.id === id);
                        return tier ? `$${tier.minCost}-${tier.maxCost === 999999 ? '+' : tier.maxCost}` : '';
                      }}
                    />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '0.5rem' }}
                    />
                    <Legend />
                    <Bar dataKey="multiplier" name="Current" fill="#64748b" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="newMultiplier" name="Recommended" fill="#10b981" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Strategy Explanation */}
            <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl p-6 border border-slate-700">
              <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Optimization Strategy
              </h3>
              <p className="text-slate-300 leading-relaxed">
                These recommendations are weighted based on two factors: <strong className="text-emerald-400">sales volume</strong> (tiers 
                with more sales get larger adjustments since they have bigger impact) and <strong className="text-cyan-400">headroom</strong> (tiers 
                with lower current margins can be increased more without hitting price sensitivity). Adjustments are capped at 25% 
                per tier to minimize price shock on any individual part.
              </p>
            </div>

            {/* Export Section */}
            <div className="bg-emerald-500/10 rounded-2xl p-6 border border-emerald-500/30">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-emerald-500/20 rounded-xl flex items-center justify-center">
                  <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">Export Your New Matrix</h3>
                  <p className="text-slate-400 text-sm">Download to update your POS system</p>
                </div>
              </div>
              
              <div className="grid sm:grid-cols-3 gap-3">
                <button
                  onClick={exportCSV}
                  className="flex items-center justify-center gap-2 px-4 py-3 bg-emerald-500 text-slate-950 font-semibold rounded-xl hover:bg-emerald-400 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Download CSV
                </button>
                
                <button
                  onClick={exportReport}
                  className="flex items-center justify-center gap-2 px-4 py-3 bg-slate-700 text-white font-semibold rounded-xl hover:bg-slate-600 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Full Report (.txt)
                </button>
                
                <button
                  onClick={copyToClipboard}
                  className="flex items-center justify-center gap-2 px-4 py-3 bg-slate-700 text-white font-semibold rounded-xl hover:bg-slate-600 transition-colors"
                >
                  {copied ? (
                    <>
                      <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Copied to Clipboard!
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Copy to Clipboard
                    </>
                  )}
                </button>
              </div>
              
              <p className="text-slate-500 text-xs mt-3">
                CSV format works with most shop management systems including Tekmetric, Shop-Ware, and Mitchell.
              </p>
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => setStep(3)}
                className="px-6 py-4 bg-slate-800 text-white font-semibold rounded-xl hover:bg-slate-700 transition-colors"
              >
                ← Adjust Target
              </button>
              <button
                onClick={() => {
                  setStep(1);
                  setRecommendations(null);
                  setPartsData([]);
                  setTierAnalysis([]);
                }}
                className="flex-1 py-4 bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 font-semibold rounded-xl hover:opacity-90 transition-opacity"
              >
                Start New Analysis
              </button>
            </div>
          </div>
        )}
      </div>
      
      {/* Footer */}
      <div className="max-w-6xl mx-auto mt-12 text-center text-slate-600 text-sm">
        Price Matrix Optimizer • All calculations performed locally in your browser
      </div>
    </div>
  );
}
