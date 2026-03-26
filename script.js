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
            
            // スタックに対するスペーサー効果の判定
            if (metricKey === 'stack' && isTooLong) {
                if (spacer <= 5) {
                    solLong = "下向きに角度のついたステムへ交換してください。（現在スペーサー量が少ないため、ステムでの対応が必須です）";
                }
            }

            // スタックが高すぎて「❌ フレーム交換」判定になったが、スペーサーで大部分が構成されている場合の救済
            if (metricKey === 'stack' && isTooLong && ev.icon === '❌') {
                const frameOnlyDiff = actual - spacer - idealVal; // スペーサー全抜き時の差
                if (frameOnlyDiff <= this.thresholds.stack[1]) {
                    // スペーサーを抜けば🔺や⭕️の範囲に収まる場合
                    ev = { 
                        icon: '🔺', 
                        statusClass: 'eval-warn', 
                        label: 'まずはスペーサー減量を推奨'
                    };
                    solLong = "まずはスペーサーを減らして様子を見ましょう。それでも高すぎる場合にフレームサイズ変更を検討してください。";
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
            const idealBracket = ideal.topTube; // ブラケット基準の理想値（全部位の比較小屴）

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
                message: `トップチューブ：握る部位別の評価 <span style="font-size:0.8em;color:#a1a1aa">（比較小屴：ブラケット基準の理想値 ${idealBracket}mm）</span>`,
                advice: `<table style="width:100%;border-collapse:collapse;margin-top:0.5em;font-size:0.9em"><thead><tr style="color:#a1a1aa"><th style="text-align:left">握る部位</th><th style="text-align:left">位置の目安</th><th>実効リーチ<br><small style="font-weight:normal">（トップ${actualTop}mm+オフセット）</small></th><th>評価<br><small style="font-weight:normal">（理想値${idealBracket}mmとの差）</small></th></tr></thead><tbody>${rows}</tbody></table>`,
                solution: '普段メインで握る部位の評価が「⭕️」に近いほど、理想的なポジションに合っています。'
            });
        }
        addEval('stack', '実質スタック(スペーサ込)', effectiveStack, ideal.stack,
            "上体が起き上がりすぎてお尻が痛くなりやすいほか、空気抵抗も増大します。",
            "過度な前傾姿勢となり、腰痛や首の痛みの原因になるほか踏み込みづらくなります。",
            "スペーサーを減らしてステムを下げるか、下向きに角度のついたステムを使用してください。",
            "スペーサーを積む、または上向きのステムに変更してハンドル高を上げてください。"
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
            bikeGeometry: bikeGeometry
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
    try {
        const savedJson = localStorage.getItem('savedBikesList');
        if (savedJson) savedBikesList = JSON.parse(savedJson) || [];
    } catch (e) {
        console.warn('savedBikesList の読み込みに失敗しました。リセットします。', e);
        savedBikesList = [];
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
    }
});
