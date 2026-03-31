/**
 * 自転車の適合度を診断するクラス
 */
class BikeFitAnalyzer {
    constructor() {
        // 判定基準 (mm) [⭕️の境界(微調整レベル), 🔺の境界(パーツ交換レベル)]
        // これを超える差は ❌ (フレームサイズ変更レベル)
        this.thresholds = {
            seatTube: [15, 40],
            topTube: [10, 25],
            stack: [15, 35],
            reach: [10, 20]
        };
    }

    getEval(metric, diffVal) {
        const [t1, t2] = this.thresholds[metric];
        if (diffVal <= t1) return { icon: '⭕️', statusClass: 'eval-ok', label: '気になるレベル（微調整可）' };
        if (diffVal <= t2) return { icon: '🔺', statusClass: 'eval-warn', label: 'パーツ交換等で対応可能' };
        return { icon: '❌', statusClass: 'eval-danger', label: 'フレームサイズ変更推奨' };
    }
  
    calculateIdealGeometry(rider) {
        const { height, inseam, armLength, stemLength, riderStyle } = rider;
  
        // -------------------------
        // 1. トップチューブ長（水平換算）の算出
        // -------------------------
        const baseTopTube = height * 0.318;
        const standardInseam = height * 0.46; 
        const torsoDiff = standardInseam - inseam; // プラスなら平均より胴長、マイナスなら足長
        const standardArm = height * 0.38;
        const armDiff = armLength - standardArm;   // プラスなら平均より腕が長い
        
        const actualStem = stemLength || 100;
        // 体幹長が入力されている場合はその値を、未入力の場合は身長から33.5%前後と推計する
        const torso = rider.torsoLength || (height * 0.335); 
        
        // 乗り方のスタイル（前傾具合）による補正値と係数
        let postureFactor = 0.53; // 標準・スポーティ
        let saddleMultiplier = 0.870; // 中級者標準
        let styleStackMod = 0;
        let styleReachMod = 0;

        if (riderStyle === 'aggressive') {
            postureFactor = 0.54; // レース（深い前傾）
            saddleMultiplier = 0.885; // 上級者レース志向
            styleStackMod = -15; // スタックを下げる
            styleReachMod = 10;  // リーチを伸ばす
        } else if (riderStyle === 'comfort') {
            postureFactor = 0.52; // ツーリング（上体起こし）
            saddleMultiplier = 0.860; // 初級者・エンデュランス志向
            styleStackMod = 25;  // スタックを上げる
            styleReachMod = -10; // 近くて楽なリーチに
        }

        const idealTopTube = (torso + armLength) * postureFactor - actualStem;

        // -------------------------
        // 2. その他のジオメトリ算出
        // -------------------------
        const idealSeatTube = inseam * 0.65; // C-T長
        const idealSaddleHeight = inseam * saddleMultiplier; // 乗り方に応じたサドル高
        const idealStack = (inseam * 0.69) + styleStackMod;
        const idealReach = (height * 0.222) + styleReachMod;
  
        return {
            saddleHeight: Math.round(idealSaddleHeight),
            seatTube: Math.round(idealSeatTube),
            topTube: Math.round(idealTopTube),
            stack: Math.round(idealStack),
            reach: Math.round(idealReach),
            styleTopTubeMod: `(係数 ${postureFactor})`,
            styleStackMod: styleStackMod,
            styleReachMod: styleReachMod,
            saddleMultiplier: saddleMultiplier,
            postureFactor: postureFactor,
            torso: Math.round(torso)
        };
    }
  
    analyzeFit(rider, bikeGeometry) {
        const ideal = this.calculateIdealGeometry(rider);
        const evaluations = [];
        let errorCount = 0; // 🔺と❌の数
        
        // スペーサーやステム角による実質的なスタック・リーチの上昇分
        const spacer = rider.spacerHeight || 0;
        const effectiveStack = bikeGeometry.stack + spacer;
        const effectiveReach = bikeGeometry.reach - (spacer * 0.3);

        const addEval = (metricKey, name, actual, idealVal, adviceLong, adviceShort, solLong, solShort) => {
            let diff = actual - idealVal;
            
            // シートチューブの判定：クリアランス（適正サドル高 - 実際のC-T）に着目する
            if (metricKey === 'seatTube') {
                const clearance = ideal.saddleHeight - actual;
                if (diff > 0) {
                    if (clearance >= 120) {
                        diff = 0; // クリアランスが十分なら実質的な問題なし（許容範囲）
                    } else if (clearance > 0) {
                        diff = 120 - clearance; // 120mmに足りない分だけを実質的な差とする
                    }
                } else if (diff < 0) {
                    // 短すぎる場合も、一般的なシートポスト（最大出代 約250mm）で届く範囲であれば問題ない
                    if (clearance <= 250) {
                        diff = 0; // 実用上全く問題なし
                    } else {
                        // 250mmを超えるとポスト長が足りないリスク大
                        diff = 250 - clearance; // 足りない分を差分とする（負の値）
                    }
                }
            }

            const diffAbs = Math.round(Math.abs(diff));
            const isTooLong = actual > idealVal; // 表示用の文言判定（実際の数値ベースで高いか低いか）
            let ev = this.getEval(metricKey, diffAbs);
            
            // スタックに対するコラムスペーサ効果の判定
            if (metricKey === 'stack' && isTooLong) {
                if (spacer <= 5) {
                    solLong = "下向きに角度のついたステムへ交換してください。（現在コラムスペーサ量が少ないため、ステムでの対応が必須です）";
                }
            }

            // スタックが高すぎて「❌ フレーム交換」判定になったが、コラムスペーサで大部分が構成されている場合の救済
            if (metricKey === 'stack' && isTooLong && ev.icon === '❌') {
                const frameOnlyDiff = actual - spacer - idealVal; // コラムスペーサ全抜き時の差
                if (frameOnlyDiff <= this.thresholds.stack[1]) {
                    // コラムスペーサを抜けば🔺や⭕️の範囲に収まる場合
                    ev = { 
                        icon: '🔺', 
                        statusClass: 'eval-warn', 
                        label: 'まずはコラムスペーサ減量を推奨'
                    };
                    solLong = "まずはコラムスペーサを減らして様子を見ましょう。それでも高すぎる場合にフレームサイズ変更を検討してください。";
                }
            }

            if (ev.icon === '🔺' || ev.icon === '❌') errorCount++;

            let message = `${name}は完全に一致しています！ [⭕️ 完璧]`;
            if (diffAbs > 0) {
                message = `${name} が体に比べて ${(metricKey === 'stack' || metricKey === 'seatTube') ? (isTooLong ? '高い' : '低い') : metricKey === 'reach' ? (isTooLong ? '長い' : '短い') : (isTooLong ? '遠い' : '近い')} です (差: ${diffAbs}mm) <span class="eval-label">【${ev.label}】</span>`;
            } else if (actual !== idealVal) {
                // diffが0に補正されたが実際の数値が異なる場合（シートチューブの許容等）
                message = `${name} は理想値(${idealVal}mm)と異なりますが、適正なポジションを出す上で問題ない範囲です。 [⭕️ 許容範囲]`;
            }

            evaluations.push({
                icon: ev.icon,
                statusClass: ev.statusClass,
                message: message,
                advice: diffAbs === 0 ? "問題ありません。" : (isTooLong ? adviceLong : adviceShort),
                solution: diffAbs === 0 ? "そのままお乗りいただけます。" : (isTooLong ? solLong : solShort)
            });
        };

        addEval('seatTube', 'シートチューブ', bikeGeometry.seatTube, ideal.seatTube,
            "サドルを十分に下げられず、適正なサドル高を出せない可能性があります。", 
            "サドルを限界まで上げる必要があり、シートポストが足りなくなるリスクがあります。",
            "ワンサイズ小さなフレームを検討してください。", 
            "長めのシートポストへの交換、またはワンサイズ大きなフレームを検討してください。"
        );

        addEval('topTube', 'トップチューブ', bikeGeometry.topTube, ideal.topTube,
            "上半身が前に引っ張られ、首や肩、腰に過度な緊張が出やすくなります。",
            "上体・肘が窮屈になり、体幹が使いにくくなる可能性があります。",
            "短いステムへの交換、またはリーチの短いハンドルバーに変更してください。",
            "長いステムに交換し、乗車空間を確保してください。"
        );

        // ハンドル各部位を握ったときのトップチューブ評価
        // 「実際に手が届く距離」= actualTop(バイク実測値) + 握り位置オフセット
        // それをブラケット基準の理想値（idealBracket）と比較する
        // ※以前は理想値側をオフセットしていたが、実際には「手が前方に移動する」ので実測値側を加算するのが正しい
        {
            const actualTop = bikeGeometry.topTube;
            const idealBracket = ideal.topTube; // ブラケット基準の理想値（全部位の比較指標）

            // 各部位の握り位置オフセット（フラット部を基準=0）
            // ブラケットを握るとフラットより約75-80mm前方に手が移動する
            // ショルダーを握るとフラットより約65mm前方
            // ドロップを握るとブラケットよりさらに約50mm前方（フラットから紏125mm前方）
            const gripPositions = [
                { label: 'フラット部（上ハン）', gripOffset: 0,   note: '基準位置' },
                { label: 'ショルダー部',        gripOffset: 65,  note: 'フラットより約65mm前方' },
                { label: 'ブラケット部',        gripOffset: 75,  note: 'フラットより約75mm前方（計算基準）' },
                { label: 'ドロップ部（下ハン）', gripOffset: 125, note: 'フラットより約125mm前方' },
            ];

            const rows = gripPositions.map(({ label, gripOffset, note }) => {
                // 実際に手が届く距離（バイク実測値 + 部位ほど前方に手が移動）
                const effectiveReach = actualTop + gripOffset;
                // ブラケット基準の理想値と比較
                // +なら「遠い（手が届きすぎる）」、-なら「近い（手が届かない）」
                const diff = effectiveReach - idealBracket;
                const diffAbs = Math.abs(Math.round(diff));
                const tooFar = diff > 0;
                let ev;
                if (diffAbs <= 10) ev = { icon: '⭕️', cls: 'eval-ok' };
                else if (diffAbs <= 25) ev = { icon: '🔺', cls: 'eval-warn' };
                else ev = { icon: '❌', cls: 'eval-danger' };
                const diffStr = diffAbs === 0 ? '一致' : `${tooFar ? '+' : '-'}${diffAbs}mm (実効: ${effectiveReach}mm、${tooFar ? '遠い' : '近い'})`;
                return `<tr><td>${label}</td><td style="color:#a1a1aa;font-size:0.85em">${note}</td><td style="text-align:center">${effectiveReach}mm</td><td style="text-align:center" class="${ev.cls}">${ev.icon} ${diffStr}</td></tr>`;
            }).join('');

            evaluations.push({
                icon: '🚴',
                statusClass: 'eval-ok',
                message: `トップチューブ：握る部位別の評価 <span style="font-size:0.8em;color:#a1a1aa">（比較指標：ブラケット基準の理想値 ${idealBracket}mm）</span>`,

                advice: `<table style="width:100%;border-collapse:collapse;margin-top:0.5em;font-size:0.9em"><thead><tr style="color:#a1a1aa"><th style="text-align:left">握る部位</th><th style="text-align:left">位置の目安</th><th>実効リーチ<br><small style="font-weight:normal">（トップ${actualTop}mm+オフセット）</small></th><th>評価<br><small style="font-weight:normal">（理想値${idealBracket}mmとの差）</small></th></tr></thead><tbody>${rows}</tbody></table>`,
                solution: '普段メインで握る部位の評価が「⭕️」に近いほど、理想的なポジションに合っています。'
            });
        }
        addEval('stack', '実質スタック(コラムスペーサ込)', effectiveStack, ideal.stack,
            "上体が起き上がりすぎてお尻が痛くなりやすいほか、空気抵抗も増大します。",
            "過度な前傾姿勢となり、腰痛や首の痛みの原因になるほか踏み込みづらくなります。",
            "コラムスペーサを減らしてステムを下げるか、下向きに角度のついたステムを使用してください。",
            "コラムスペーサを積む、または上向きのステムに変更してハンドル高を上げてください。"
        );

        addEval('reach', '実質リーチ(スペーサ込)', effectiveReach, ideal.reach,
            "腕が伸び切りハンドリングが不安定になり、肩や首への負担が大きくなります。",
            "ハンドルが近すぎて上体が詰まったような窮屈な姿勢になり、ペダリングがしづらくなります。",
            "短いステムやショートリーチハンドルへの交換をしてください。",
            "長いステムへの交換、またはスペーサーを抜いてハンドルを下げる調整をしてください。"
        );

        // リーチとスタックの複合的な問題（両方長い/高い）が起きている場合、統合した提案を出す
        const stackEval = evaluations.find(e => e.message.includes('実質スタック'));
        const reachEval = evaluations.find(e => e.message.includes('実質リーチ'));
        if (stackEval && reachEval && stackEval.icon !== '⭕️' && reachEval.icon !== '⭕️') {
            const isStackHigh = (effectiveStack - ideal.stack) > 10;
            const isReachLong = (effectiveReach - ideal.reach) > 10;
            if (isStackHigh && isReachLong) {
                const comboSolution = "短めで下向き角度のついたステムへ交換し、リーチ長とスタック高を同時に改善してください。";
                stackEval.solution = comboSolution;
                reachEval.solution = comboSolution;
            }
        }

        // トップチューブとリーチの矛盾（トップチューブが短くてリーチが長い場合）
        const topTubeEval = evaluations.find(e => e.message.includes('トップチューブ'));
        if (topTubeEval && reachEval && topTubeEval.icon !== '⭕️' && reachEval.icon !== '⭕️') {
            const isTopTubeShort = (bikeGeometry.topTube - ideal.topTube) < -10;
            const isReachLong = (effectiveReach - ideal.reach) > 10;
            if (isTopTubeShort && isReachLong) {
                const conflictResolution = "<strong>🔧 複合改善案:</strong> リーチ（前方距離）が長いため、トップチューブが短くてもステムを長くしてはいけません。短めのステムでハンドルの遠さを解消し、サドルのセットバック（後退幅）で前後の乗車空間を確保してください。";
                topTubeEval.solution = conflictResolution;
                reachEval.solution = conflictResolution;
            }
        }

        // トータル評価に補完指標（S/R比率、ハンドルドロップ、プロポーション）を追加
        const srRatio = bikeGeometry.stack / (bikeGeometry.reach || 1);
        let srStyle = "";
        let srAdvice = "";
        if (srRatio < 1.45) { srStyle = "アグレッシブレース"; srAdvice = "深い前傾姿勢を要求される競技者向けのジオメトリです。"; }
        else if (srRatio < 1.55) { srStyle = "標準ロード"; srAdvice = "一般的なロードバイクのバランスです。"; }
        else if (srRatio < 1.65) { srStyle = "エンデュランス"; srAdvice = "上体が起きる快適な長距離向けのジオメトリです。"; }
        else { srStyle = "グラベル/ツーリング"; srAdvice = "非常に上体が起きるアップライトなジオメトリです。"; }

        evaluations.push({
            icon: '📐',
            statusClass: 'eval-ok',  
            message: `フレームの Stack/Reach 比率は ${srRatio.toFixed(2)} (${srStyle}相当) です`,
            advice: srAdvice,
            solution: "ご自身の選択した『乗り方スタイル』とバイクの特性が一致しているか、確認の目安にしてください。"
        });

        const handleDrop = Math.round(ideal.saddleHeight - effectiveStack);
        let dropStyle = "";
        if (handleDrop < 30) dropStyle = "快適・エンデュランス向け";
        else if (handleDrop <= 60) dropStyle = "標準的〜やや深めの前傾";
        else dropStyle = "レーシーな深い前傾（アグレッシブ）";

        evaluations.push({
            icon: '📉',
            statusClass: 'eval-ok',
            message: `推定されるサドル〜ハンドルのドロップ差は ${handleDrop}mm (${dropStyle}) です`,
            advice: "サドルトップからハンドル上部にかけての落差に関する指標です。",
            solution: "ご自身の柔軟性や選択したスタイルに合った前傾の深さになっているか確認してください。"
        });

        const torsoRatio = ideal.torso / rider.height;
        const armRatio = rider.armLength / rider.height;
        let propMsg = "";
        if (torsoRatio < 0.32) propMsg += "体幹が短め（足長） / ";
        else if (torsoRatio > 0.35) propMsg += "体幹が長め / ";
        if (armRatio < 0.38) propMsg += "腕が短め / ";
        else if (armRatio > 0.40) propMsg += "腕が長め / ";
        
        if (propMsg) {
            evaluations.push({
                icon: '👤',
                statusClass: 'eval-warn',
                message: `平均から外れた身体的特徴があります: ${propMsg.replace(/ \/ $/, '')}`,
                advice: "標準的な比率から外れている場合、理論上の理想ジオメトリからの計算結果に誤差が生じやすくなります。",
                solution: "ご自身の特徴（腕の長さなど）に合わせて、ステム長やサドル位置を計算値よりもさらに微調整することをお勧めします。"
            });
        }

        return {
            bikeSize: bikeGeometry.sizeName,
            isFit: errorCount === 0,
            errorCount: errorCount,
            details: evaluations,
            idealGeometryInfo: ideal,
            bikeGeometry: bikeGeometry,
            rider: rider
        };
    }
}

// UI Interaction
document.addEventListener('DOMContentLoaded', () => {
    const analyzer = new BikeFitAnalyzer();
    const analyzeBtn = document.getElementById('analyze-btn');
    const resultArea = document.getElementById('result-area');
    
    // 【機能追加】localStorage から以前の入力データを読み込む
    try {
        const savedRaw = localStorage.getItem('bikeFitData');
        if (savedRaw) {
            const savedData = JSON.parse(savedRaw);
            if (savedData.riderHeight) document.getElementById('rider-height').value = savedData.riderHeight;
            if (savedData.riderInseam) document.getElementById('rider-inseam').value = savedData.riderInseam;
            if (savedData.riderArm) document.getElementById('rider-arm').value = savedData.riderArm;
            if (savedData.riderTorso) document.getElementById('rider-torso').value = savedData.riderTorso;
            if (savedData.riderStem) document.getElementById('rider-stem').value = savedData.riderStem;
            if (savedData.riderSpacer) document.getElementById('rider-spacer').value = savedData.riderSpacer;
            if (savedData.riderStyle) document.getElementById('rider-style').value = savedData.riderStyle;
            
            if (savedData.bikeSize) document.getElementById('bike-size').value = savedData.bikeSize;
            if (savedData.bikeStack) document.getElementById('bike-stack').value = savedData.bikeStack;
            if (savedData.bikeReach) document.getElementById('bike-reach').value = savedData.bikeReach;
            if (savedData.bikeSeat) document.getElementById('bike-seat').value = savedData.bikeSeat;
            if (savedData.bikeTop) document.getElementById('bike-top').value = savedData.bikeTop;
        }
    } catch (e) {
        console.error("Local storage load failed:", e);
    }

    // ======== 【機能追加】バイクジオメトリの保存・読み込み ========
    let savedBikesList = [];
    const defaultSampleBikes = [
        {
            name: '3T Exploro Racemax XXS',
            stack: 520,
            reach: 355,
            seatTube: 436,
            topTube: 506
        },
        {
            name: '3T Exploro Racemax 51',
            stack: 542,
            reach: 366,
            seatTube: 463,
            topTube: 526
        },
        {
            name: '3T Exploro Racemax 54',
            stack: 564,
            reach: 377,
            seatTube: 490,
            topTube: 546
        },
        {
            name: '3T Exploro Racemax 56',
            stack: 584,
            reach: 385,
            seatTube: 518,
            topTube: 566
        },
        {
            name: '3T Exploro Racemax 58',
            stack: 604,
            reach: 393,
            seatTube: 545,
            topTube: 586
        },
        {
            name: '3T Exploro Racemax 61',
            stack: 632,
            reach: 404,
            seatTube: 572,
            topTube: 606
        },
        {
            name: 'Scott Addict XXS (47)',
            stack: 517.8,
            reach: 376.3,
            seatTube: 470,
            topTube: 515
        },
        {
            name: 'Scott Addict XS (49)',
            stack: 529.1,
            reach: 383.2,
            seatTube: 490,
            topTube: 525
        },
        {
            name: 'Scott Addict S (52)',
            stack: 551.6,
            reach: 387,
            seatTube: 520,
            topTube: 540
        },
        {
            name: 'Scott Addict M (54)',
            stack: 572.4,
            reach: 390.9,
            seatTube: 540,
            topTube: 555
        },
        {
            name: 'Scott Addict L (56)',
            stack: 593.3,
            reach: 394.3,
            seatTube: 560,
            topTube: 570
        }
    ];

    try {
        const savedJson = localStorage.getItem('savedBikesList');
        if (savedJson) savedBikesList = JSON.parse(savedJson) || [];
    } catch (e) {
        console.warn('savedBikesList の読み込みに失敗しました。リセットします。', e);
        savedBikesList = [];
    }

    if (savedBikesList.length === 0) {
        savedBikesList = [...defaultSampleBikes];
        localStorage.setItem('savedBikesList', JSON.stringify(savedBikesList));
    } else {
        // 既存データがある場合でも、プリセットの新規サイズが不足していたら追加する
        const existingNames = new Set(savedBikesList.map(b => b.name));
        const missingDefaults = defaultSampleBikes.filter(b => !existingNames.has(b.name));
        if (missingDefaults.length > 0) {
            savedBikesList = [...savedBikesList, ...missingDefaults];
            localStorage.setItem('savedBikesList', JSON.stringify(savedBikesList));
        }
    }

    const savedBikesSelect = document.getElementById('saved-bikes-list');
    
    function renderSavedBikes() {
        if(!savedBikesSelect) return;
        savedBikesSelect.innerHTML = '<option value="">-- 新規入力 --</option>';
        savedBikesList.forEach((bike, index) => {
            const opt = document.createElement('option');
            opt.value = index;
            // リストで分かりやすいように主要スペックを表示
            opt.textContent = `${bike.name} (Reach: ${bike.reach}, Stack: ${bike.stack})`;
            savedBikesSelect.appendChild(opt);
        });
    }
    renderSavedBikes();

    if(savedBikesSelect) {
        savedBikesSelect.addEventListener('change', () => {
            const idx = savedBikesSelect.value;
            if (idx !== "") {
                const bike = savedBikesList[idx];
                document.getElementById('bike-size').value = bike.name;
                document.getElementById('bike-stack').value = bike.stack;
                document.getElementById('bike-reach').value = bike.reach;
                document.getElementById('bike-seat').value = bike.seatTube;
                document.getElementById('bike-top').value = bike.topTube;
            }
        });

        document.getElementById('save-bike-btn').addEventListener('click', (e) => {
            e.preventDefault();
            const name = document.getElementById('bike-size').value.trim();
            if (!name) return alert('保存するには「サイズ名」を入力してください。');
            
            const bike = {
                name: name,
                stack: parseFloat(document.getElementById('bike-stack').value) || 0,
                reach: parseFloat(document.getElementById('bike-reach').value) || 0,
                seatTube: parseFloat(document.getElementById('bike-seat').value) || 0,
                topTube: parseFloat(document.getElementById('bike-top').value) || 0
            };
            
            // 同名があれば上書き、なければ追加
            const existingIndex = savedBikesList.findIndex(b => b.name === name);
            if (existingIndex >= 0) {
                savedBikesList[existingIndex] = bike;
            } else {
                savedBikesList.push(bike);
            }
            localStorage.setItem('savedBikesList', JSON.stringify(savedBikesList));
            renderSavedBikes();
            // 保存したものを選択状態にする
            savedBikesSelect.value = existingIndex >= 0 ? existingIndex : savedBikesList.length - 1;
            alert(`「${name}」のジオメトリを保存しました！`);
        });

        document.getElementById('delete-bike-btn').addEventListener('click', (e) => {
            e.preventDefault();
            const idx = savedBikesSelect.value;
            if (idx === "") return alert('削除するジオメトリをリストから選択してください。');
            
            if (confirm(`「${savedBikesList[idx].name}」を保存リストから削除しますか？`)) {
                savedBikesList.splice(idx, 1);
                localStorage.setItem('savedBikesList', JSON.stringify(savedBikesList));
                renderSavedBikes();
                savedBikesSelect.value = "";
            }
        });
    }
    // ======== /ここまで ========

    analyzeBtn.addEventListener('click', () => {
        // ボタンのアニメーション
        analyzeBtn.style.transform = 'scale(0.98)';
        setTimeout(() => analyzeBtn.style.transform = '', 150);

        // 入力値の取得（もし「cm」で入力されていたら、自動的に「mm」に倍増して補正する）
        let rHeight = parseFloat(document.getElementById('rider-height').value) || 0;
        let rInseam = parseFloat(document.getElementById('rider-inseam').value) || 0;
        let rArm = parseFloat(document.getElementById('rider-arm').value) || 0;
        let rTorso = parseFloat(document.getElementById('rider-torso').value) || 0;

        if (rHeight > 0 && rHeight < 300) rHeight *= 10;   // 例：165 -> 1650
        if (rInseam > 0 && rInseam < 200) rInseam *= 10;   // 例：74 -> 740
        if (rArm > 0 && rArm < 150) rArm *= 10;            // 例：65 -> 650
        if (rTorso > 0 && rTorso < 150) rTorso *= 10;      // 例：60 -> 600

        const riderData = {
            height: rHeight,
            inseam: rInseam,
            armLength: rArm,
            torsoLength: rTorso,
            stemLength: parseFloat(document.getElementById('rider-stem').value) || 90,
            spacerHeight: parseFloat(document.getElementById('rider-spacer').value) || 0,
            riderStyle: document.getElementById('rider-style').value || 'standard'
        };

        const bikeGeometry = {
            sizeName: document.getElementById('bike-size').value || 'Unknown Size',
            stack: parseFloat(document.getElementById('bike-stack').value) || 0,
            reach: parseFloat(document.getElementById('bike-reach').value) || 0,
            seatTube: parseFloat(document.getElementById('bike-seat').value) || 0,
            topTube: parseFloat(document.getElementById('bike-top').value) || 0
        };

        // バリデーション
        const invalidRiderFields = [];
        if (!riderData.height || riderData.height < 1200 || riderData.height > 2400) invalidRiderFields.push('身長');
        if (!riderData.inseam || riderData.inseam < 500 || riderData.inseam > 1100) invalidRiderFields.push('股下長');
        if (!riderData.armLength || riderData.armLength < 400 || riderData.armLength > 900) invalidRiderFields.push('腕の長さ');
        if (riderData.torsoLength && (riderData.torsoLength < 300 || riderData.torsoLength > 1000)) invalidRiderFields.push('体幹長');
        if (!riderData.stemLength || riderData.stemLength < 50 || riderData.stemLength > 150) invalidRiderFields.push('ステム長');
        if (riderData.spacerHeight < 0 || riderData.spacerHeight > 150) invalidRiderFields.push('スペーサー量');

        if (invalidRiderFields.length > 0) {
            alert(`身体情報が不正な値です: ${invalidRiderFields.join('、')}。入力を確認してください。`);
            return;
        }

        const invalidBikeFields = [];
        if (!bikeGeometry.stack || bikeGeometry.stack < 350 || bikeGeometry.stack > 700) invalidBikeFields.push('スタック');
        if (!bikeGeometry.reach || bikeGeometry.reach < 300 || bikeGeometry.reach > 500) invalidBikeFields.push('リーチ');
        if (!bikeGeometry.seatTube || bikeGeometry.seatTube < 300 || bikeGeometry.seatTube > 700) invalidBikeFields.push('シートチューブ');
        if (!bikeGeometry.topTube || bikeGeometry.topTube < 400 || bikeGeometry.topTube > 650) invalidBikeFields.push('トップチューブ');

        if (invalidBikeFields.length > 0) {
            alert(`自転車ジオメトリが不正な値です: ${invalidBikeFields.join('、')}。入力を確認してください。`);
            return;
        }

        // 【機能追加】現在の入力を localStorage に保存する
        const dataToSave = {
            riderHeight: document.getElementById('rider-height').value,
            riderInseam: document.getElementById('rider-inseam').value,
            riderArm: document.getElementById('rider-arm').value,
            riderTorso: document.getElementById('rider-torso').value,
            riderStem: document.getElementById('rider-stem').value,
            riderSpacer: document.getElementById('rider-spacer').value,
            riderStyle: document.getElementById('rider-style').value,
            bikeSize: document.getElementById('bike-size').value,
            bikeStack: document.getElementById('bike-stack').value,
            bikeReach: document.getElementById('bike-reach').value,
            bikeSeat: document.getElementById('bike-seat').value,
            bikeTop: document.getElementById('bike-top').value
        };
        localStorage.setItem('bikeFitData', JSON.stringify(dataToSave));

        // 診断の実行
        const result = analyzer.analyzeFit(riderData, bikeGeometry);

        // 結果の描画
        displayResults(result);
    });

    function displayResults(result) {
        resultArea.classList.remove('hidden');
        
        const statusBadge = document.getElementById('result-status');
        const detailsList = document.getElementById('result-details');
        const idealStats = document.getElementById('ideal-stats');

        // バッジの設定
        if (result.errorCount === 0) {
            statusBadge.className = 'status-badge success';
            statusBadge.innerHTML = `✨ ${result.bikeSize} は非常に理想に近いサイズです！`;
        } else {
            statusBadge.className = 'status-badge error';
            statusBadge.innerHTML = `⚠️ ${result.bikeSize} は一部調整・変更が必要な箇所があります（警告 ${result.errorCount}件）`;
        }

        // 詳細リストの設定
        detailsList.innerHTML = '';
        result.details.forEach(issue => {
            const li = document.createElement('li');
            li.className = `eval-item ${issue.statusClass}`;

            const adviceHtml = issue.advice === '問題ありません。' ? '' : `
                <div class="issue-advice"><strong>💡 体への影響:</strong> ${issue.advice}</div>
                <div class="issue-solution" style="margin-top: 0.4rem;"><strong>🔧 改善案:</strong> ${issue.solution}</div>
            `;

            li.innerHTML = `
                <div class="issue-main">
                    <span class="eval-icon">${issue.icon}</span> 
                    <span>${issue.message}</span>
                </div>
                ${adviceHtml}
            `;
            detailsList.appendChild(li);
        });

        // 理想ジオメトリの設定
        const ideal = result.idealGeometryInfo;
        const input = result.bikeGeometry;
        idealStats.innerHTML = `
            <div class="stat-box primary-stat">
                <span class="label">【参考】サドル高 (BB〜トップ)</span>
                <span class="value">${ideal.saddleHeight} <small>mm</small></span>
            </div>
            <div class="stat-box">
                <span class="label">理想スタック</span>
                <span class="value">${ideal.stack} <small>mm</small><br><span style="font-size: 0.75em; color: #a1a1aa; font-weight: normal;">(入力: ${input.stack}mm)</span></span>
            </div>
            <div class="stat-box">
                <span class="label">理想リーチ</span>
                <span class="value">${ideal.reach} <small>mm</small><br><span style="font-size: 0.75em; color: #a1a1aa; font-weight: normal;">(入力: ${input.reach}mm)</span></span>
            </div>
            <div class="stat-box">
                <span class="label">理想 C-T</span>
                <span class="value">${ideal.seatTube} <small>mm</small><br><span style="font-size: 0.75em; color: #a1a1aa; font-weight: normal;">(入力: ${input.seatTube}mm)</span></span>
            </div>
            <div class="stat-box">
                <span class="label">理想 トップ</span>
                <span class="value">${ideal.topTube} <small>mm</small><br><span style="font-size: 0.75em; color: #a1a1aa; font-weight: normal;">(入力: ${input.topTube}mm)</span></span>
            </div>
                            <div class="stat-box">
                    <span class="label">シートポスト突き出し量（目安）</span>
                    <span class="value">${ideal.saddleHeight - input.seatTube} <small>mm</small><br><span style="font-size: 0.75em; color: #a1a1aa; font-weight: normal;">サドル高${ideal.saddleHeight}mm − C-T${input.seatTube}mm</span></span>
                </div>
            <div class="logic-explanation" style="grid-column: 1 / -1; width: 100%; margin-top: 15px; font-size: 0.85em; color: #a1a1aa; background: rgba(255,255,255,0.03); padding: 12px; border-radius: 8px; line-height: 1.5;">
                <strong>💡 算出ロジックと判定基準について</strong><br>
                ・<strong>サドル高:</strong> 選択されたレベル係数（${ideal.saddleMultiplier.toFixed(3)}）× 股下 で算出しています。（初級0.860/中級0.870/上級0.885）<br>
                ・<strong>トップチューブ:</strong> （体幹長＋腕）× 姿勢係数（${ideal.postureFactor.toFixed(2)}）− ステム長 で推計しています。<br>
                ・<strong>判定の閾値:</strong> 理論値からの差分が ±10〜15mm以内なら「⭕️ 微調整可」、±25〜40mm以内なら「🔺 パーツ交換で対応可能」、それ以上大きく乖離している場合は「❌ フレーム変更推奨」として判定しています。（※部位やスペーサー量によって許容範囲を動的に調整しています）
            </div>
        `;

        // 少しスクロール
        resultArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        // グラフィカル表示を更新
        drawFitVisualization(result);
    }

    function drawFitVisualization(result) {
        const canvas = document.getElementById('fit-canvas');
        if (!canvas || !canvas.getContext) return;

        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        ctx.clearRect(0, 0, width, height);

        const bike = result.bikeGeometry;
        const ideal = result.idealGeometryInfo;
        const rider = result.rider || { height: 1700, torsoLength: 650, armLength: 620, spacerHeight: 0 };

        const effectiveStack = bike.stack + (rider.spacerHeight || 0);

        const margin = { left: 50, top: 30, right: 20, bottom: 40 };
        const plotWidth = width * 0.56 - margin.left - margin.right;
        const plotHeight = height - margin.top - margin.bottom;

        const maxReach = Math.max(bike.reach, ideal.reach, bike.topTube, ideal.topTube);
        const maxStack = Math.max(effectiveStack, ideal.stack, bike.stack);

        const xMin = Math.min(-Math.max(120, maxReach * 0.2), 0);
        const xMax = Math.max(maxReach * 1.1, 200);
        const yMin = 0;
        const yMax = Math.max(maxStack * 1.1, 300);

        const scaleX = plotWidth / (xMax - xMin);
        const scaleY = plotHeight / (yMax - yMin);
        const scale = Math.min(scaleX, scaleY);

        const originX = margin.left - xMin * scale; // BB(0)を基準化
        const originY = margin.top + plotHeight;    // BB(0)をここに

        const toX = mm => originX + mm * scale;
        const toY = mm => originY - mm * scale;

        // 軸とグリッド
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(toX(xMin), originY);
        ctx.lineTo(toX(xMax), originY);
        ctx.moveTo(toX(0), originY);
        ctx.lineTo(toX(0), toY(yMax));
        ctx.stroke();

        ctx.font = '11px Inter, sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.textAlign = 'center';

        const hsteps = 8;
        const vsteps = 6;
        for (let i = 0; i <= hsteps; i++) {
            const rx = xMin + ((xMax - xMin) / hsteps) * i;
            const x = toX(rx);
            ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
            ctx.beginPath();
            ctx.moveTo(x, originY);
            ctx.lineTo(x, toY(yMax));
            ctx.stroke();
            ctx.fillText(`${Math.round(rx)}mm`, x, originY + 15);
        }
        ctx.textAlign = 'right';
        for (let i = 0; i <= vsteps; i++) {
            const sy = yMin + ((yMax - yMin) / vsteps) * i;
            const y = toY(sy);
            ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
            ctx.beginPath();
            ctx.moveTo(toX(xMin), y);
            ctx.lineTo(toX(xMax), y);
            ctx.stroke();
            ctx.fillText(`${Math.round(sy)}mm`, toX(0) - 6, y + 4);
        }

        // 原点（BB）表示
        ctx.fillStyle = '#a5f3fc';
        ctx.beginPath();
        ctx.arc(toX(0), originY, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f9fafb';
        ctx.textAlign = 'left';
        ctx.fillText('BB (0,0)', toX(0) + 6, originY - 6);

        // フレーム形状を実際の座標で表示（シートチューブ・ダウンチューブ・トップチューブ）
        const bbPt = { x: toX(0), y: originY };
        const seatTopPt = { x: toX(0), y: toY(bike.seatTube) };
        const headTopPt = { x: toX(bike.reach), y: toY(bike.stack) };
        const projectedTopPt = { x: toX(bike.topTube), y: toY(bike.stack) }; // 水平換算トップチューブの位置

        // シートチューブ
        ctx.strokeStyle = '#60a5fa';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(bbPt.x, bbPt.y);
        ctx.lineTo(seatTopPt.x, seatTopPt.y);
        ctx.stroke();

        // ダウンチューブ
        ctx.beginPath();
        ctx.moveTo(bbPt.x, bbPt.y);
        ctx.lineTo(headTopPt.x, headTopPt.y);
        ctx.stroke();

        // 実トップチューブ（シートチューブ上端 -> ヘッドチューブ上端）
        ctx.beginPath();
        ctx.moveTo(seatTopPt.x, seatTopPt.y);
        ctx.lineTo(headTopPt.x, headTopPt.y);
        ctx.stroke();

        // メーカー水平TT
        ctx.strokeStyle = '#7dd3fc';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(toX(0), toY(bike.stack));
        ctx.lineTo(projectedTopPt.x, projectedTopPt.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // ステム・ハンドル配置
        const stemLength = rider.stemLength || 90;
        const stemLengthPx = stemLength * scale;
        const stemAngleRad = -Math.PI / 12; // 上向き少し
        const handlebarLogical = {
            x: bike.reach + stemLength * Math.cos(stemAngleRad),
            y: effectiveStack + stemLength * Math.sin(stemAngleRad)
        };
        const stemEndPt = {
            x: headTopPt.x + Math.cos(stemAngleRad) * stemLengthPx,
            y: headTopPt.y + Math.sin(stemAngleRad) * stemLengthPx
        };

        // ステム
        ctx.strokeStyle = '#fb7185';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(headTopPt.x, headTopPt.y);
        ctx.lineTo(stemEndPt.x, stemEndPt.y);
        ctx.stroke();

        // ハンドル位置
        ctx.fillStyle = '#fb7185';
        ctx.beginPath();
        ctx.arc(stemEndPt.x, stemEndPt.y, 5, 0, Math.PI * 2);
        ctx.fill();

        // ハンドル名
        ctx.fillStyle = '#f9fafb';
        ctx.font = '12px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('ハンドル', stemEndPt.x + 8, stemEndPt.y - 6);

        // サドル位置としてシートチューブ上端も表示
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.arc(seatTopPt.x, seatTopPt.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f9fafb';
        ctx.fillText('サドル', seatTopPt.x + 8, seatTopPt.y - 6);

        ctx.fillStyle = '#60a5fa';
        ctx.font = '11px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`実トップ ${Math.round(Math.hypot(bike.reach, bike.stack - bike.seatTube))}mm`, (seatTopPt.x + headTopPt.x) / 2 + 6, (seatTopPt.y + headTopPt.y) / 2 - 6);
        ctx.fillText(`水平TT ${Math.round(bike.topTube)}mm`, originX + 6, toY(bike.stack) - 8);

        // 実測と理想ポイント
        const drawDot = (x, y, color, label) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(x, y, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = color;
            ctx.font = '12px Inter, sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(label, x + 8, y - 8);
        };

        drawDot(headTopPt.x, headTopPt.y, '#fbbf24', '実測ヘッドチューブ');
        drawDot(handlebarPt.x, handlebarPt.y, '#f59e0b', '実測ハンドル');
        drawDot(toX(ideal.reach), toY(ideal.stack), '#34d399', '理想ハンドル');

        // 差分矢印（リーチ/スタック）
        ctx.strokeStyle = '#f87171';
        ctx.fillStyle = '#f87171';
        ctx.setLineDash([4, 2]);
        ctx.beginPath();
        const xA = toX(bike.reach); const yA = toY(effectiveStack);
        const xB = toX(ideal.reach); const yB = toY(ideal.stack);
        ctx.moveTo(xA, yA);
        ctx.lineTo(xB, yB);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        const headX = xB + (xA > xB ? -8 : 8);
        const headY = yB + (yA > yB ? -8 : 8);
        ctx.arc(headX, headY, 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.font = '12px Inter, sans-serif';
        ctx.fillStyle = '#f9fafb';
        ctx.fillText(`ΔReach: ${Math.round(bike.reach - ideal.reach)}mm`, originX + 2, margin.top + 14);
        ctx.fillText(`ΔStack: ${Math.round(effectiveStack - ideal.stack)}mm`, originX + 2, margin.top + 30);

        // サドル、ステム、ハンドル位置を描画
        const saddlePt = seatTopPt;
        const handlebarPt = stemEndPt;

        // サドル点
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.arc(saddlePt.x, saddlePt.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f9fafb';
        ctx.font = '12px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('サドル', saddlePt.x + 8, saddlePt.y - 6);

        // ステム線・ハンドル位置
        ctx.strokeStyle = '#fb7185';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(headTopPt.x, headTopPt.y);
        ctx.lineTo(handlebarPt.x, handlebarPt.y);
        ctx.stroke();

        ctx.fillStyle = '#fb7185';
        ctx.beginPath();
        ctx.arc(handlebarPt.x, handlebarPt.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f9fafb';
        ctx.fillText('ハンドル', handlebarPt.x + 8, handlebarPt.y - 6);

        // ライダーの上体座標（シート→ハンドル方向に体幹を置く）
        const seatCoord = { x: 0, y: bike.seatTube };
        const hbCoord = { x: handlebarLogical.x, y: handlebarLogical.y };
        const bodyDx = hbCoord.x - seatCoord.x;
        const bodyDy = hbCoord.y - seatCoord.y;
        const bodyDist = Math.sqrt(bodyDx * bodyDx + bodyDy * bodyDy) || 1;
        const torsoLen = Math.min(rider.torsoLength || 650, bodyDist - 50);
        const shoulderCoord = {
            x: seatCoord.x + bodyDx * (torsoLen / bodyDist),
            y: seatCoord.y + bodyDy * (torsoLen / bodyDist)
        };

        const shoulderPt = { x: toX(shoulderCoord.x), y: toY(shoulderCoord.y) };

        // ライダー姿勢（簡易）
        ctx.strokeStyle = '#fde047';
        ctx.lineWidth = 2;

        // 胴
        ctx.beginPath();
        ctx.moveTo(saddlePt.x, saddlePt.y);
        ctx.lineTo(shoulderPt.x, shoulderPt.y);
        ctx.stroke();

        // 頭
        const headRadius = 8;
        ctx.fillStyle = '#fde047';
        ctx.beginPath();
        ctx.arc(shoulderPt.x, shoulderPt.y - 16, headRadius, 0, Math.PI * 2);
        ctx.fill();

        // 腕
        ctx.beginPath();
        ctx.moveTo(shoulderPt.x, shoulderPt.y);
        ctx.lineTo(handlebarPt.x, handlebarPt.y);
        ctx.stroke();

        // 脚（ペダル位置=BBに近い想定）
        ctx.beginPath();
        ctx.moveTo(saddlePt.x, saddlePt.y);
        ctx.lineTo(bbPt.x + 20, bbPt.y);
        ctx.moveTo(saddlePt.x, saddlePt.y);
        ctx.lineTo(bbPt.x - 20, bbPt.y);
        ctx.stroke();

        // テキスト
        ctx.fillStyle = '#f9fafb';
        ctx.font = '11px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`ステム ${stemLength}mm`, headTopPt.x, headTopPt.y - 14);

        // 棒人間（右側エリア）
        const figureBaseX = width * 0.65;
        const figureBaseY = height - 18;
        const figureScale = Math.min((height - 90) / (rider.height || 1700), 0.22);

        const drawStickman = (cx, cy, totalHeight, torsoLen, armLen, color, label) => {
            const headR = 8;
            const torsoPx = torsoLen * figureScale;
            const legPx = (totalHeight - torsoLen) * figureScale;
            const armPx = armLen * figureScale * 0.7;
            const shoulderY = cy - legPx - torsoPx * 0.3;
            const hipY = cy - legPx;
            const headY = shoulderY - headR * 2;

            ctx.strokeStyle = color;
            ctx.fillStyle = color;
            ctx.lineWidth = 2;

            ctx.beginPath();
            ctx.arc(cx, headY, headR, 0, Math.PI * 2);
            ctx.fill();

            // 体幹
            ctx.beginPath();
            ctx.moveTo(cx, shoulderY);
            ctx.lineTo(cx, hipY);
            ctx.stroke();

            // 腕
            ctx.beginPath();
            ctx.moveTo(cx, shoulderY);
            ctx.lineTo(cx - armPx, shoulderY + armPx * 0.1);
            ctx.moveTo(cx, shoulderY);
            ctx.lineTo(cx + armPx, shoulderY + armPx * 0.1);
            ctx.stroke();

            // 足
            ctx.beginPath();
            ctx.moveTo(cx, hipY);
            ctx.lineTo(cx - legPx * 0.4, cy);
            ctx.moveTo(cx, hipY);
            ctx.lineTo(cx + legPx * 0.4, cy);
            ctx.stroke();

            ctx.fillStyle = '#e2e8f0';
            ctx.font = '12px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(label, cx, cy + 16);
        };

        drawStickman(figureBaseX + 30, figureBaseY, rider.height, rider.torsoLength, rider.armLength, '#fbbf24', '身体適合');
        drawStickman(figureBaseX + 140, figureBaseY, ideal.stack + ideal.reach * 0.6, ideal.torso || 650, rider.armLength, '#34d399', 'フレームフィット（理想）');

        ctx.globalAlpha = 1;
    }
});
