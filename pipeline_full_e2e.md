# QTAP Pipeline — Full End-to-End Parameter Reference

> Tài liệu này mô tả chi tiết mọi tham số trong hệ thống QTAP, bóc tách bản chất toán học "tận gốc", giải thích tường tận từng phép toán và phân loại các biến vào các Bucket chiến lược.

## 0. Overall Overview

### 0.1 Flow A — Market State $\rightarrow$ Stochastic State
>
> $$\underbrace{\text{1s OHLCV}}_{\Delta t = 1s}
> \xrightarrow[\text{cadence } 1s]{\text{Oracle ingest}}
> \underbrace{(C_t,H_t,L_t,a_t)}_{\substack{\text{price state}\\ \text{time anchor}}}
> \xrightarrow[\ln]{\text{1s close return}}
> \underbrace{r_t}_{\text{core 1s observable}}
> \xrightarrow[h]{\text{EWMA update}}
> \underbrace{\sigma_t}_{\text{diffusive state}}$$

### 0.2 Flow B — Volatility State $\rightarrow$ Excitation State
>
> $$\underbrace{(r_t,\sigma_t)}_{\text{normalized move test}}
> \xrightarrow[\kappa_0,\ \kappa_q,\ \sigma_{ref}]{\text{Rare-move detection}}
> \underbrace{I_t^{obs}}_{\text{binary shock flag}}
> \xrightarrow[\mu_0,\ \alpha_{hawkes},\ \beta]{\text{Hawkes recursion}}
> \underbrace{\lambda_{t+1}}_{\text{excitation state}}$$

### 0.3 Flow C — Excitation State $\rightarrow$ Quote Surface
>
> $$\underbrace{(\sigma_t,\lambda_{t+1})}_{\text{pricing state}}
> \xrightarrow[N_{MC},\ \Delta t = 1s]{\text{Log-normal MC}}
> \underbrace{\{S^{(n)}\}}_{\text{future paths}}
> \xrightarrow{\text{Brownian Bridge}}
> \underbrace{P_{raw}(c)}_{\text{raw touch probability by cell}}
> \xrightarrow[m_{eff},\ K_{skew},\ K_{safety}]{\text{Risk-aware quote map}}
> \underbrace{M_{final}(c)}_{\text{quoted multiplier}}$$

### 0.4 Cách đọc 3 flows trên

*   **Flow A — Oracle state $\rightarrow \sigma_t$:** Dữ liệu đầu vào là nến `1s` từ Binance. Ở nhịp `1s`, volatility core đọc theo log-return close-to-close. `time anchor` $a_t = 5\lfloor t/5 \rfloor$ thuộc contract grid, không làm grid update chậm thành 5 giây.
*   **Flow B — $\sigma_t \rightarrow \lambda_{t+1}$:** Volatility state chưa đủ để mô tả các cú sốc cụm. Vì vậy, return hiện tại được chuẩn hóa bởi $\sigma_t$, kiểm tra bằng ngưỡng hiếm động, rồi cập nhật thêm một excitation state $\lambda_{t+1}$ qua Hawkes recursion.
*   **Flow C — $(\sigma_t,\lambda_{t+1}) \rightarrow M_{final}(c)$:** Cặp state nén đi vào Monte Carlo để sinh paths, Brownian Bridge để tính xác suất chạm intra-bar, rồi quote engine mới áp margin, skew, và safety overlays để tạo ra multiplier cuối cùng.
*   **Nguyên tắc đọc SSOT này:** Ở mỗi tầng bên dưới, nên đọc theo thứ tự `Flow` trước, sau đó mới đọc `Core Computation`, rồi mới xuống phần `Vai trò biến / tác động tới model`. Làm như vậy sẽ tránh nhầm lẫn giữa luồng dữ liệu và chi tiết toán học.

![TapL model flow](architecture/externals/whitepaper/img/generated/tapl_model_flow.png)

### 0.5 Quy ước ký hiệu dùng xuyên suốt tài liệu

Để tránh lẫn giữa đối tượng toán học, trường dữ liệu trong code, và các đại lượng dùng cho việc đổi kích thước lưới, tài liệu này chốt các ký hiệu sau. Quy ước cốt lõi là: **giá dùng chữ $S$**, còn **xác suất dùng chữ $P$**.

*   **$u$:** chỉ số của một segment `1s` bên trong window của cell.
*   **$n$:** chỉ số của một đường Monte Carlo.
*   **$r$:** chỉ số **hàng giá** của lưới. Trong principal mode hiện tại, $r\in\{0,\dots,19\}$. Trong phần chữ, tài liệu dùng cụm “hàng giá”; trong công thức, chỉ dùng ký hiệu $r$. Không dùng từ `row` nữa, trừ khi đang nhắc đúng tên field trong code như `row_count`.
*   **$w$:** chỉ số cửa sổ thời gian (window index) của cell.
*   **$j$:** chỉ số của một trạng thái lịch sử trong tập trạng thái gần đây dùng để quyết định `dP`.
*   **$S_t$:** giá close/oracle tại thời điểm $t$ trong phần notation toán học.
*   **$dP$:** độ rộng của một hàng giá, tính bằng USD.
*   **$L$:** cận dưới của một band giá.
*   **$H$:** cận trên của một band giá. Tài liệu dùng $H$ thay cho $R$ để nhất quán với trục giá theo phương thẳng đứng.
*   **$P_{touch,u}^{(n)}(c)$:** xác suất path $n$ chạm cell $c$ trong đúng segment `1s` thứ $u$ sau khi áp dụng Brownian Bridge.
*   **$P^{(n)}(c)$:** xác suất path $n$ chạm cell $c$ trong toàn bộ window của cell, sau khi gộp tất cả segment `1s` thuộc window đó.
*   **$P_{raw}(c)$:** xác suất chạm cell chuẩn của pipeline. Đây là trung bình Monte Carlo của $P^{(n)}(c)$ trên toàn bộ paths. Khi nói “xác suất thô” trong phần toán học chính, mặc định đang nói tới đối tượng này.
*   **$q_{r,w}(dP)$:** khối lượng xác suất đã chuẩn hóa của hàng giá $r$ trong cửa sổ thời gian $w$ dưới một giá trị `dP`.
*   **$N_{eff,w}(dP)$:** số hàng hiệu dụng của cửa sổ $w$ dưới một giá trị `dP`; đây là số đo entropy để biết xác suất đang trải lên bao nhiêu hàng một cách thực chất.
*   **$T_{hold}$:** khoảng thời gian hệ thống dự định giữ nguyên `dP` trước khi đánh giá lại.
*   **$T_{hist}$:** cửa sổ dữ liệu gần đây dùng để dựng tập trạng thái phục vụ quyết định `dP`.

Phiên bản cũ từng dùng cùng chữ `P` cho hai nghĩa khác nhau:

*   **`P_t` / `P_u`** để chỉ **giá**;
*   **`P_touch`, `P_raw`** để chỉ **xác suất**.

Collision này nằm ngay trong chính phần toán của pipeline. Bây giờ tài liệu đã chốt **giá dùng $S$**, nên có thể quay lại dùng **$P$ cho xác suất** mà không còn trùng nghĩa. Vì vậy tài liệu chốt:

*   **$S$** cho giá;
*   **$P$** cho xác suất chạm;
*   **$q$** cho profile xác suất đã chuẩn hóa theo hàng giá.

Nếu cần hiện thực hóa phần chọn `dP` trong code, hãy xem `P_raw_model` như tên biến gần nhất với xác suất chạm thô trước các lớp hiệu chỉnh xác suất. Tuy nhiên, tài liệu toán học **không** đặt thêm ký hiệu riêng cho trường này; trong công thức chính vẫn dùng tên chung là $P_{raw}$ để tránh sinh thêm một lớp ký hiệu chỉ dành cho mã nguồn.

Ngoài ra, tài liệu này phân biệt 3 loại đại lượng:

*   **Hằng số cấu trúc:** semantics lõi của model, ví dụ `1s OHLCV`, `1s oracle update`, `1s MC step`, `1s settlement evidence`, và luật build cell từ `band_width`.
*   **Thông số điều hành:** các mốc do protocol chọn để vận hành, ví dụ tập giá trị cho phép của `dP`, $T_{hold}$, $T_{hist}$, các ngưỡng độ phủ xác suất, hay ngân sách rủi ro dùng cho bài toán đổi lưới.
*   **Trạng thái thích ứng:** các biến được đọc từ thị trường hoặc treasury tại thời điểm quyết định, ví dụ $S_t$, $\sigma_{final,t}$, $\lambda_{t+1}$, house balance, liability snapshot, và phân phối các state gần đây.

---

## 1. Tầng 1: Time Grid Structure

### 1.1 Oracle Tick Rate ($\Delta t$)
*   **Giá trị:** $1.0$ (giây).
*   **Bản chất:** Đơn vị thời gian cơ sở. Trong mọi công thức tiếp theo, $\Delta t = 1$ giúp đơn giản hóa việc tính toán Volatility (vốn luôn đi kèm $\sqrt{\Delta t}$ hoặc $\Delta t$).
*   **Tại sao:** Binance 1s kline là dữ liệu mịn nhất hiện có mà không cần truy cập trực tiếp vào Orderbook (thấp hơn 1s cần L3 data).

### 1.2 Principal Grid Geometry (State cadence vs Contract cadence)
*   **Nhịp state update:** $1s$. Mỗi bar mới đi vào sẽ cập nhật Volatility state, Jump state và Oracle state.
*   **Nhịp contract:** principal mode hiện tại dùng các cửa sổ 5 giây:
    $$a = 5 \left\lfloor \frac{t_{oracle}}{5} \right\rfloor \xrightarrow{\text{Build windows}} [a+5,a+10), [a+10,a+15), \ldots, [a+60,a+65)$$
*   **Giá trị hiện tại trong code (`fortress/engine.py`):**
    *   `mode_id="5"` là mode chính nội bộ.
    *   `band_width = \$5`
    *   `row_count = 20`
    *   `center_row = 9`
    *   `betable` chỉ bật từ cửa sổ có `T_start \ge a+10`, tức là bỏ qua window sát hiện tại nhất.
*   **Ý nghĩa:** Model update mỗi giây, nhưng contract mà user thấy là các ô giá $\times$ thời gian 5 giây. Đây là hai lớp khác nhau, không được nhập làm một.

#### **Code Snapshot (fortress/engine.py)**
```python
time_anchor = (self._oracle_second // 5) * 5

"5": ModeConfig(
    mode_id="5",
    band_width=5.0,
    windows=[
        (5, 10), (10, 15), (15, 20), (20, 25),
        (25, 30), (30, 35), (35, 40), (40, 45),
        (45, 50), (50, 55), (55, 60), (60, 65),
    ],
    row_count=20,
    center_row=(20 - 1) // 2,
)
```

---

## 2. Tầng 2: Adaptive Volatility (Biến động thích ứng)

### 2.0 Flow riêng của Tầng 2
> **Luồng Data (Data Flow):**
> 
> $$ S_t, S_{t-1} \xrightarrow{\text{1s close return}} r_t \xrightarrow{\text{EWMA}} v_t \xrightarrow{\text{Sqrt}} \sigma_{raw} \xrightarrow{\text{Optional scale}} \sigma_{final} $$

**Mô tả luồng:** Tầng này nhận dữ liệu giá thô từ sàn và chuyển đổi nó thành một volatility state có thể mang sang các tầng stochastic phía sau. Policy đang chốt cho TapL là: ở `dT = 1s`, volatility core đọc close-to-close. Điểm quan trọng là `Flow` ở đây chỉ cho biết dữ liệu đi từ đâu đến đâu; toàn bộ công thức chi tiết được tách xuống phần dưới để người đọc không bị đứt nhịp.

### 2.0.1 Các phép tính cốt lõi của Tầng 2
$$S_t, S_{t-1} \xrightarrow{\text{Log-return}} r_t \xrightarrow{\text{Square}} v_t^{obs}=r_t^2$$
$$v_{t-1}, v_t^{obs} \xrightarrow[\alpha_{vol}]{\text{EWMA recursion}} v_t \xrightarrow{\text{Sqrt}} \sigma_{raw} \xrightarrow{\text{Optional scaling}} \sigma_{final}$$

**Diễn giải ngắn:** Return-based variance bắt chuyển động điểm cuối ở đúng cadence `1s`; EWMA tạo bộ nhớ theo thời gian; căn bậc hai đưa variance về volatility; còn scaling chỉ là lớp hiệu chỉnh tùy runtime, không phải phần bất biến của lý thuyết.

![Volatility transformation](architecture/externals/whitepaper/img/generated/tapl_volatility_transform.png)

### 2.1 Return-based Variance ($v_t^{ret}$)
*   **Công thức:** 
    $$S_t, S_{t-1} \xrightarrow[\text{Tỷ suất Log}]{\text{Lợi nhuận}} v_t^{ret} = \underbrace{[\ln(S_t / S_{t-1})]^2}_{\text{Phương sai Return}}$$
*   **Bóc tách bản chất:**
    *   $S_t / S_{t-1}$: Tỷ lệ thay đổi giá.
    *   $\ln(\cdot)$: Chuyển từ không gian nhân sang cộng. $\implies$ Log-returns có tính chất cộng dồn (Time-additivity).
    *   Bình phương ($^2$): Định nghĩa của Phương sai (Variance) là mô-men bậc 2 quanh giá trị trung bình ($E[r^2]$).
*   **Tại sao:** Ở khung 1s, giá đóng cửa mang tính chất "điểm cuối". Nó đại diện cho kết quả cuối cùng của hàng ngàn giao dịch trong 1 giây đó.

### 2.2 High/Low trong pipeline hiện tại
*   **Vai trò hiện tại:** High/Low trong OHLCV `1s` vẫn cần cho settlement và kiểm tra xem contract đã touch band hay chưa.
*   **Không phải volatility core:** Trong tài liệu TapL hiện tại, volatility core chỉ dùng close-to-close return:
    $$v_t^{obs}=r_t^2.$$
*   **Công thức Parkinson gốc:** Nếu chạy ablation riêng, công thức range estimator cổ điển là:
    $$v_t^{park}=\frac{[\ln(H_t/L_t)]^2}{4\ln2}.$$
    Dạng blend tổng quát là:
    $$v_t^{obs}=(1-w_P)r_t^2+w_Pv_t^{park}.$$
    Main path hiện tại chốt `parkinson_weight = w_P = 0`, nên:
    $$v_t^{obs}=r_t^2.$$
*   **Lý do tách vai trò:** Settlement cần biết path thực tế trong 1 giây đã chạm band hay chưa; volatility state cần một observable nhất quán với cadence pricing. Hai vai trò này không nên bị nhập làm một.

### 2.3 Composite Observed Variance ($v_t^{obs}$)
*   **Công thức:** 
    $$v_t^{obs}=v_t^{ret}=r_t^2,\qquad \Delta t=1s.$$
*   **Nguyên tắc mô hình hóa của TapL:** Ở `dT=1s`, không đưa thêm range-blend vào volatility core.
*   **Ghi chú hiện thực:** Engine vẫn giữ `parkinson_weight` như một nút ablation tường minh, nhưng các mặc định chính (`GlobalConfig`, `DecisionCycleConfig`, live env fallback, `CandidateSpec`) đều để `0.0`. Nếu một script tự truyền `parkinson_weight > 0`, đó là đường ablation/legacy diagnostic, không phải đường chính của paper.

#### **Code Snapshot (fortress/engine.py)**
```python
v_obs = r_s * r_s
```

### 2.4 EWMA Recursion (Làm mượt phương sai)
*   **Công thức:** 
    $$v_{t-1} \xrightarrow[\text{Hệ số phân rã } \alpha_{vol}]{\text{Cập nhật biến động}} v_t = \underbrace{(1 - \alpha_{vol}) v_t^{obs}}_{\text{Thông tin hiện tại}} + \underbrace{\alpha_{vol} v_{t-1}}_{\text{Bộ nhớ quá khứ}}$$
*   **Hệ số Decay ($\alpha_{vol}$):** $\alpha_{vol} = \exp\left( \underbrace{-\frac{\ln(2)}{h}}_{\text{Tỷ lệ rã}} \right)$.
    *   $h$ (Half-life - Bucket B): Số giây để trọng số của dữ liệu quá khứ giảm đi một nửa. Principal mode hiện tại trong `default_modes()` dùng $h = 20$ giây.
    *   `DecisionCycleConfig.ewma_half_life_seconds = None` theo mặc định, nghĩa là evaluator thường **thừa kế** giá trị $20s$ từ mode thay vì tự đè một giá trị khác.
    *   Hàm $e$: Đảm bảo $\alpha_{vol}$ luôn dương và phân rã theo tỷ lệ phần trăm liên tục.

### 2.5 Sigma Scaling ($\sigma_{final}$)
*   **Công thức:** 
    $$\sigma_{raw} \xrightarrow[\text{Tùy toggle runtime}]{\text{Scale hoặc không scale}} \sigma_{final}
    =
    \underbrace{\sigma_{raw}}_{\text{Vol thô}}
    \times
    \underbrace{\eta_{\sigma}}_{\substack{\text{Sigma scaling}\\ \text{(optional)}}}
    \times
    \underbrace{\eta_{S}}_{\substack{\text{Price scaling}\\ \text{(optional)}}}$$
*   **Bóc tách bản chất:**
    1.  **$\sigma_{raw} = \sqrt{v_t}$:** Bước chuyển đổi từ Phương sai (Variance) về Độ lệch chuẩn (Volatility) bằng căn bậc hai. $\implies$ Đây là biến động thô ước lượng từ thị trường.
    2.  **$\eta_{\sigma}$ (Sigma scaling toggle):**
        *   Nếu `use_sigma_scaling = False` $\implies \eta_{\sigma} = 1$.
        *   Nếu `use_sigma_scaling = True` $\implies \eta_{\sigma} = s_{mode}$ với principal mode hiện tại `sigma_scale = 0.05`.
        *   **Insight quan trọng:** `sigma_scale = 0.05` hiện **không tác động** đến core live path vì toggle mặc định tắt. Nó tồn tại như một legacy ablation knob, không phải bất biến của lý thuyết.
    3.  **$\eta_{S}$ (Price scaling toggle):**
        $$\eta_S = \operatorname{clip}\left(\sqrt{\frac{\max(S_t, 10{,}000)}{100{,}000}},\ 0.7,\ 1.3\right)$$
        *   `100,000` là mốc tham chiếu giá BTC đang được code dùng để chuẩn hóa mức khó tương đối của một band cố định.
        *   `10,000` là sàn bảo vệ số học, tránh scale quá méo nếu giá đầu vào quá thấp.
        *   `clip(0.7, 1.3)` là biên guardrail để lớp scale này không bóp hay nới Vol quá mạnh.
    4.  **Core live vs evaluator:**
        *   **Core live runtime:** `use_sigma_scaling = False`, `use_price_scaling = False` $\implies \sigma_{final} = \sigma_{raw}$.
        *   **Decision-cycle evaluator:** mặc định hiện cũng `use_price_scaling = False` $\implies$ evaluator không còn tự bật price scaling so với core path. Nếu bật lại, đó là ablation/calibration path.

#### **Code Snapshot (fortress/engine.py)**
```python
sigma = sigma_raw
if getattr(self.config, 'use_sigma_scaling', False):
    sigma *= max(mode.sigma_scale, self.config.epsilon)
if getattr(self.config, 'use_price_scaling', False):
    price_adj = math.sqrt(max(price, 10000.0) / 100000.0)
    sigma *= max(0.7, min(1.3, price_adj))
```

---

## 3. Tầng 3: Jump Detection & Hawkes

### 3.0 Flow riêng của Tầng 3
> **Luồng Data (Data Flow):**
> 
> $$ r_t,\ \sigma_{raw} \xrightarrow{\text{Z-score}} z_t \xrightarrow{\text{Dynamic Threshold } \kappa_t} I_t^{obs} $$
> $$ \lambda_t,\ I_t^{obs} \xrightarrow{\text{Hawkes Update}} \lambda_{t+1} $$

**Mô tả luồng:** Đây là hệ thống cảnh báo sớm của model. Tầng 2 đã cho chúng ta mức biến động nền $\sigma_{raw}$; Tầng 3 dùng chính đại lượng đó để chuẩn hóa return hiện tại, phát hiện move hiếm, rồi bơm cú sốc đó vào Hawkes recursion nhằm dự báo dư chấn ngắn hạn. Nói cách khác, `sigma` là input để quyết định xem biến động hiện tại có đáng được coi là shock hay không, còn `lambda` là output thể hiện mức độ hưng phấn còn sót lại của thị trường sau cú sốc đó.

### 3.0.1 Các phép tính cốt lõi của Tầng 3
$$|r_t|,\ \sigma_{raw} \xrightarrow{\text{Standardize}} z_t = \frac{|r_t|}{\sigma_{raw}}$$
$$\sigma_{raw} \xrightarrow{\text{Adaptive threshold}} \kappa_t = \operatorname{clip}\left(\kappa_0 \left(\frac{\sigma_{raw}}{\sigma_{ref}}\right)^{\kappa_q}, \kappa_{min}, \kappa_{max}\right)$$
$$z_t,\ \kappa_t \xrightarrow{\text{Compare}} I_t^{obs} = \mathbb{I}(z_t > \kappa_t)$$
$$\lambda_t,\ I_t^{obs} \xrightarrow[\text{shock } \alpha_{hawkes}]{\text{decay } \beta} \lambda_{t+1} = \mu_0 + \exp(-\beta \cdot \Delta t)\cdot(\lambda_t - \mu_0) + \alpha_{hawkes} \cdot I_t^{obs}$$

**Diễn giải ngắn:** Nhịp tính ở đây phải đọc theo đúng thứ tự: chuẩn hóa return $\rightarrow$ dựng ngưỡng động $\rightarrow$ kết luận có shock hay không $\rightarrow$ cập nhật excitation state. Nếu nhảy thẳng vào công thức Hawkes mà bỏ qua bước chuẩn hóa bởi $\sigma_{raw}$ thì người đọc sẽ không hiểu vì sao cùng một return tuyệt đối lại có lúc được xem là jump, có lúc không.

### 3.1 Jump Detection ($I_t^{obs}$)
*   **Công thức:** 
    $$|r_t| \xrightarrow[\text{Chuẩn hóa bởi } \sigma_{raw}]{\text{Z-score}} z_t = \frac{|r_t|}{\sigma_{raw}}$$
    $$\sigma_{raw} \xrightarrow[\text{Reference normalize}]{\text{Adaptive threshold}} \kappa_t = \operatorname{clip}\left(\kappa_0 \left(\frac{\sigma_{raw}}{\sigma_{ref}}\right)^{\kappa_q}, \kappa_{min}, \kappa_{max}\right)$$
    $$z_t, \kappa_t \xrightarrow{\text{So sánh}} I_t^{obs} = \mathbb{I}(z_t > \kappa_t)$$
*   **Giải thích:**
    *   $|r_t| / \sigma_{raw}$: Đây là $Z$-score. Nó cho biết "Biến động giây này gấp mấy lần bình thường?".
    *   Principal mode hiện tại dùng:
        *   $\kappa_0 = 3.1$
        *   $\kappa_q = 0.5$
        *   $\kappa_{min} = 2.7$
        *   $\kappa_{max} = 6.0$
    *   **Tại sao không dùng một $\kappa$ cố định?**
        *   Nếu threshold cố định, regime yên tĩnh sẽ trigger quá nhiều false jump.
        *   Nếu threshold cố định, regime cực vol lại có thể bỏ lọt các cú move đã trở thành "bình thường mới".
        *   Việc cho $\kappa_t$ tăng theo $\sigma_{raw}/\sigma_{ref}$ khiến detector co giãn theo regime hiện tại.

#### **Code Snapshot (fortress/engine.py)**
```python
sigma_raw = math.sqrt(max(v_now, self.config.variance_floor))
z = abs(r_s) / (sigma_raw + self.config.epsilon)
sigma_ratio = max(
    sigma_raw / max(self.config.sigma_ref, self.config.epsilon),
    self.config.epsilon,
)
kappa_s = mode.kappa0 * (sigma_ratio**mode.kappa_q)
kappa_s = self._clamp(kappa_s, mode.kappa_min, mode.kappa_max)
jump_flag = z > kappa_s
```

### 3.2 Hawkes Process (Cường độ $\lambda$)
*   **Công thức trạng thái:** Trong tài liệu TapL hiện tại, ta dùng ký hiệu rời rạc để tránh nhầm giữa event counter lý thuyết và implementation.
*   **Công thức rời rạc:**
    $$\lambda_t \xrightarrow[\text{Cú sốc } \alpha_{hawkes}]{\text{Phân rã } \beta} \lambda_{t+1} = \underbrace{\mu_0}_{\text{Mức nền}} + \underbrace{\exp(-\beta \cdot \Delta t)\cdot(\lambda_t - \mu_0)}_{\text{Lực kéo về nền}} + \underbrace{\alpha_{hawkes} \cdot I_t^{obs}}_{\text{Cú hích lây lan}}$$
*   **Diễn giải luồng biến đổi ($\implies$):**
    1.  Nếu $I_t^{obs}=1$, cường độ $\lambda$ tăng ngay lập tức một lượng $\alpha_{hawkes}$.
    2.  Nếu không có shock mới, thành phần $(\lambda_t-\mu_0)$ bị kéo về nền theo hệ số $\exp(-\beta\cdot\Delta t)$.
    3.  Rời rạc hóa trên lưới $\Delta t = 1$ $\implies$ Ta có công thức đệ quy rời rạc ở trên.
*   **Giá trị hiện tại trong code:** $\mu_0 = 0.02$, $\alpha_{hawkes} = 0.18$, $\beta = 0.45$.
*   **Tại sao:** Đây là mô hình chuẩn để diễn tả tâm lý "bầy đàn" và "mau quên" của trader.

---

## 4. Tầng 4: Monte Carlo Simulation (Mô phỏng đường giá)

> **Luồng Data (Data Flow):** 
> 
> $$ \sigma_{final}, \lambda_{t+1}, \Delta t \xrightarrow{\text{Antithetic Variates}} \xi_t, -\xi_t \xrightarrow{\text{Itô + GBM}} r_t^{diff} \xrightarrow{\text{Hawkes}} \Delta\ell_t \xrightarrow{\text{Cộng dồn}} \text{Price Paths} $$
> 
> **Mô tả tổng quát:** Đây là cỗ máy tạo ra hàng ngàn kịch bản tương lai (Paths) để dự đoán đường giá ngắn hạn. Trong principal mode hiện tại, horizon mô phỏng kéo dài đến hết cửa sổ $[60,65)$ nên tối đa là **65 ticks** trong live runtime (`lock_offset = 0` qua `service.py`).
> Đầu tiên, hệ thống sinh ra một ma trận các cú "sốc" ngẫu nhiên ($\xi_t$) theo phân phối Chuẩn, đồng thời tạo ra một bản sao đối xứng ($-\xi_t$) để tối ưu tốc độ hội tụ (Kỹ thuật Antithetic Variates).
> Sau đó, phần diff được tạo ra từ độ lệch chuẩn $\sigma_{final}$, bù trừ sai số bằng Itô Drag.
> Kế tiếp, hệ thống tung xúc xắc dựa trên cường độ hoảng loạn ($\lambda_{t+1}$) từ Hawkes Process để ném thêm các Jumps lớn vào đường đi. Cuối cùng, tất cả các mảnh ghép được cộng dồn (Cumulative Sum) và hàm mũ hóa để cho ra hàng ngàn đường giá mô phỏng sinh động.

### 4.0 Nguyên tắc tái lập kết quả của mô phỏng

Monte Carlo có thành phần ngẫu nhiên, nhưng hệ thống không được vận hành như một hộp đen mỗi lần chạy ra một kết quả không truy vết được. Với cùng dữ liệu đầu vào, cùng cấu hình, cùng trạng thái engine và cùng seed hoặc cùng khóa hash, model phải tái lập được cùng chuỗi mô phỏng. Đây là nguyên tắc của cả runtime model và backtest, không chỉ là tiện ích kiểm thử.

Trong engine hiện tại, MC RNG được key theo `seed + mode_id + oracle_second + Close/S_t`. Các strategy random dùng một RNG riêng key theo `seed + strategy name + tick + P_oracle + salt`. Vì vậy “random” trong paper/pipeline nên đọc là pseudo-random deterministic theo giá close hiện tại và Time (`oracle_second`/tick), không phải nguồn nhiễu không truy vết được.

Điều này không có nghĩa mọi ứng viên tham số dùng chung một bề mặt báo giá. Mỗi ứng viên vẫn phải tự sinh xác suất và hệ số từ tham số riêng. Phần tái lập kết quả chỉ kiểm soát nguồn nhiễu mô phỏng để khi so sánh hai ứng viên, khác biệt quan sát được đến từ tham số và logic định giá nhiều hơn là từ may rủi của bộ sinh số giả ngẫu nhiên.

### 4.1 Sinh nhiễu đối xứng (Antithetic Variates)
*   **Công thức:**
    $$ \xi \sim \mathcal{N}(0,1) \xrightarrow{\text{Antithetic Variates}} \begin{cases} \text{Path}_1: & +\xi_t \\ \text{Path}_2: & -\xi_t \end{cases} $$
*   **Bản chất:** Kỹ thuật giảm phương sai (Variance Reduction).
*   **Giải thích:** Thay vì tung $N$ đồng xu ngẫu nhiên ($\xi \sim \mathcal{N}(0,1)$), hệ thống chỉ tung $N/2$ đồng xu. Với mỗi kết quả $\xi_i$, hệ thống tự động sinh ra một nhánh mô phỏng đi ngược lại ($-\xi_i$).
*   **Tư duy phản biện (Jumps vs Diff):** Việc đảo ngược $-\xi_t$ là đảo ngược phần **Mịn (Diff)**. Tuy nhiên, các cú sốc ($J_{t,k}^{(n)}$) có bị đảo ngược thành $-J_{t,k}^{(n)}$ không?
    *   *Câu trả lời trong code:* **KHÔNG**. Cả 2 nhánh Antithetic Variates đều chịu chung một cú $J_{t,k}^{(n)}$ như nhau.
    *   *Tại sao?* Vì Jumps trong Crypto (như thanh lý lệnh) là các sự kiện đuôi béo có tính định hướng (skewed tail events). Nếu ta tự ý đảo ngược cú sập sàn $-5\%$ thành một cú pump $+5\%$, ta đang ngụy tạo ra một sự kiện phi thực tế không có trong phân phối lịch sử. Việc giữ nguyên $J_{t,k}^{(n)}$ cho cả 2 nhánh giúp bảo toàn chính xác độ xiên (Skewness) và độ nhọn (Kurtosis) của phân phối đuôi béo nguyên bản.
*   **Tại sao:** Giúp giá trị trung bình của toàn bộ các kịch bản mô phỏng luôn hội tụ cực nhanh về $0$ mà không cần chạy hàng triệu đường, tiết kiệm $\approx 50\%$ chi phí máy chủ (CPU cycles).

### 4.2 Diff Component (Mô phỏng mịn với Itô)
*   **Công thức:** 
    $$ \xi_{t,k}^{(n)}\sim\mathcal{N}(0,1) $$
    $$ r_{t,k}^{diff,(n)} = \underbrace{-\frac{1}{2}\cdot\sigma_{final,t}^2\cdot\Delta t}_{\text{Itô Drag}} + \underbrace{\sigma_{final,t}\cdot\sqrt{\Delta t}\cdot\xi_{t,k}^{(n)}}_{\text{GBM}} $$
*   **Deep Dive - Tại sao có số $-0.5$? (Bóc tách Bổ đề Itô)**
    Để hiểu tường tận từ lý thuyết gốc đến code, hãy đi qua từng bước biến đổi toán học:

    **Bước 1: Khởi nguồn từ GBM (Không gian Giá)**
    Mô hình Geometric Brownian Motion (GBM) giả định thị trường Tap Trading hoàn toàn ngẫu nhiên và không thiên vị (Zero drift $\implies \mu = 0$):
    $$ S_t \xrightarrow{\text{GBM không Drift}} dS_t = \underbrace{\sigma_{final} S_t dW_t}_{\text{Biến động ngẫu nhiên}} $$
    *(Trong đó $dW_t$ là vi phân của chuyển động Brownian. Trong thế giới rời rạc, $dW_t \approx \xi_t \cdot \sqrt{\Delta t}$ với $\xi_t \sim \mathcal{N}(0,1)$; khi viết theo path-step thì dùng $\xi_{t,k}^{(n)}$).*

    **Bước 2: Chuyển sang Không gian Log (Để cộng dồn)**
    Lợi nhuận được cộng dồn dễ dàng hơn trong không gian Log. Ta đặt $X_t = \ln(S_t)$.

    **Bước 3: Áp dụng Bổ đề Itô (Itô's Lemma)**
    Bổ đề Itô cung cấp công cụ vi phân một hàm của biến ngẫu nhiên:
    $$ dX_t = \underbrace{\frac{\partial X}{\partial S} dS_t}_{\text{Bậc 1}} + \underbrace{\frac{1}{2} \frac{\partial^2 X}{\partial S^2} (dS_t)^2}_{\text{Bậc 2 (Lồi)}} $$

    **Bước 4: Tính toán từng thành phần**
    $$ \ln(S) \xrightarrow{\text{Đạo hàm bậc 1}} \frac{\partial X}{\partial S} = \frac{1}{S_t} $$
    $$ \ln(S) \xrightarrow{\text{Đạo hàm bậc 2}} \frac{\partial^2 X}{\partial S^2} = -\frac{1}{S_t^2} $$
    $$ dS_t \xrightarrow{\text{Bình phương}} (dS_t)^2 = (\sigma_{final} S_t dW_t)^2 = \sigma_{final}^2 S_t^2 \underbrace{(dW_t)^2}_{= dt} = \sigma_{final}^2 S_t^2 dt $$

    **Bước 5: Lắp ghép lại (Triệt tiêu $S_t$)**
    $$ dX_t = \left( \frac{1}{S_t} \right) (\sigma_{final} S_t dW_t) + \frac{1}{2} \left( -\frac{1}{S_t^2} \right) (\sigma_{final}^2 S_t^2 dt) $$
    $$ dX_t \xrightarrow{\text{Rút gọn}} \underbrace{-\frac{1}{2}\sigma_{final}^2 dt}_{\text{Itô Drag}} + \underbrace{\sigma_{final} dW_t}_{\text{Sốc ngẫu nhiên}} $$

    **Bản chất hình học (Bất đẳng thức Jensen):** Hàm mũ $y = e^x$ là một hàm lồi. Nếu ta chỉ dùng $r_t = \sigma_{final} \cdot \sqrt{\Delta t} \cdot \xi_t$ (bỏ qua Itô Drag), thì kỳ vọng giá mô phỏng $E[S_{t+1}] = S_t \cdot e^{0.5 \cdot \sigma_{final}^2 \cdot \Delta t}$ sẽ bị "vểnh" lên vô lý, tạo ra sự bất công (Unfairness) cho người chơi đánh short.
    $\implies$ Số $-\frac{1}{2}\sigma_{final}^2 \Delta t$ chính là "trọng lực" toán học kéo giá mô phỏng xuống, đảm bảo hệ thống là một Martingale hoàn hảo (Kỳ vọng giá tương lai đúng bằng giá hiện tại).

#### **Code Snapshot (fortress/engine.py ~L699)**
```python
# Itô correction for zero-drift GBM: add -½σ²Δt term
# For discrete time steps with Δt = 1, the correction is -0.5 * sigma**2
returns = mu - 0.5 * sigma**2 + sigma * eps
```

### 4.3 Tích hợp Hawkes Jumps (Gieo Jumps vào tương lai)
*   **Tại sao dùng $\lambda_{t+1}$?** Ở Tầng 3, sau khi quan sát dữ liệu của giây hiện tại ($t$), hệ thống đã cập nhật cường độ mới là $\lambda_{t+1}$. Đây chính là "trạng thái tâm lý" mới nhất của thị trường. Khi bước vào Tầng 4 để phóng tầm mắt mô phỏng horizon tương lai, chúng ta bắt buộc phải dùng trạng thái mới nhất này làm điểm xuất phát.
*   **Công thức xác suất Jump trong implementation:**
    $$q_t = 1 - \exp(-\lambda_{t+1}\cdot\Delta t),\qquad I_{t,k}^{MC}\sim \operatorname{Bernoulli}(q_t)$$
*   **Quá trình chèn Jumps:**
    1. Tại mỗi bước $\Delta t$, gieo xúc xắc đều (Uniform $[0, 1]$).
    2. Nếu xúc xắc $< q_t$, một cú sốc lớn $J_{t,k}^{(n)}$ sẽ được cộng thêm vào $r_{t,k}^{diff,(n)}$.
    3. $J_{t,k}^{(n)}$ lấy mẫu từ đâu? Từ **Jump Sampler** - nơi lưu trữ ngẫu nhiên (Boostrap) các cú sốc lịch sử đã từng xảy ra trên thị trường, giữ nguyên cường độ (Magnitude) và hướng (Sign).
*   **Vai trò:** Đưa hiện tượng đuôi béo (Fat-tails) vào mô phỏng, đảm bảo Model không quá lạc quan khi thị trường đang trong chuỗi thanh lý (Liquidation cascade).
*   **Insight SSOT cần nói rõ:** Current implementation **không** evolve lại Hawkes state qua từng bước tương lai. Nó lấy trạng thái hậu cập nhật hiện tại $(\sigma_{final}, \lambda_{t+1})$ rồi giữ cố định trong suốt horizon MC. Đây là một short-horizon approximation để giữ tốc độ và tính ổn định.
*   **Connection tới Monte Carlo:** Hawkes không trực tiếp tạo price path. Nó chỉ tạo intensity $\lambda_{t+1}$; MC map intensity này sang xác suất $q_t$, draw biến cố jump bằng Bernoulli indicator $I_{t,k}^{MC}$, rồi mới cộng jump magnitude $J_{t,k}^{(n)}$ vào log-return trước khi cumulative path được dựng.

![Hawkes to MC jump draw](architecture/externals/whitepaper/img/generated/tapl_hawkes_jump_bridge.png)

#### **Code Snapshot (fortress/engine.py ~L701-L710)**
```python
if lambda_intensity > 0.0:
    # Bernoulli approximation from Hawkes intensity to 1s jump event probability.
    p_jump = 1.0 - math.exp(-lambda_intensity)
    
    if not self.config.use_antithetic or n == 1:
        # Gieo xúc xắc đều [0,1) để check xem path nào dính Jump
        jump_mask = rng.random((n, horizon)) < p_jump
        jump_count = int(jump_mask.sum())
        
        # Nếu có Jump, rút ngẫu nhiên magnitude từ JumpSampler (Bootstrap)
        if jump_count > 0:
            jumps = jump_sampler.sample(jump_count, rng, sigma).astype(np.float32)
            returns[jump_mask] += jumps # Cộng dồn Jump vào Diffusion return
```

### 4.4 Cumulative Paths (Xây dựng đường giá hoàn chỉnh)
*   **Công thức:**
    $$\Delta\ell_{t,k}^{(n)} = r_{t,k}^{diff,(n)} + I_{t,k}^{MC}\cdot J_{t,k}^{(n)}$$
    $$S_{t+k}^{(n)} = S_t \cdot \exp\left( \sum_{j=1}^{k} \Delta\ell_{t,j}^{(n)} \right)$$
*   **Số lượng mô phỏng (Path Count $N$):** 
    *   Trong Code, số đường sinh ra được cấu hình từ $N=5000$ (`mc_n_min`) đến $N=10000$ (`mc_n_max`). Tại sao không phải là 1000?
    *   **Sai số chuẩn (Standard Error - SE):** Sai số của Monte Carlo giảm tỷ lệ nghịch với $\sqrt{N}$. Nghĩa là để giảm sai số đi một nửa, bạn phải tăng số paths lên gấp 4 lần.
    *   Nếu $N=1000$, $\text{SE} \approx \frac{1}{\sqrt{1000}} \approx 3.16\%$. Với principal band hiện tại chỉ rộng $\$5$, sai số $3.1\%$ là **quá lớn**, đủ để biến một kèo có lãi thành kèo lỗ (Mispricing).
    *   Khi tăng $N=5000$, $\text{SE} \approx \frac{1}{\sqrt{5000}} \approx 1.41\%$. Mức này chấp nhận được. Code có cơ chế **Adaptive MC**: nó sẽ chạy từng batch, sau đó kiểm tra `se_abs` và `se_rel` để quyết định có cần sinh thêm paths hay không.
    *   **Tách bạch core vs harness:** principal engine path dùng `5000 -> 10000` paths thích ứng. Evaluator canonical mặc định dùng `mc_n_override = 400`, còn một số sweep trong `scripts/walkforward_mode5.py` dùng `MC_N = 80` để trade tốc độ lấy artifact. Không được lấy số của harness rồi nói đó là "mức MC chuẩn" của core model.
*   **Numeric guard hiện tại không còn giống bản cũ:**
    *   `epsilon = 10^{-12}` bảo vệ log/division/probability.
    *   `variance_floor = 10^{-18}` bảo vệ căn bậc hai của phương sai và mẫu số của bridge.
    *   Nhận định cũ “$\epsilon = 10^{-6}$ đang chặn đáy variance” **không còn đúng** với code hiện tại.
    *   Tuy nhiên, mọi floor kiểu này vẫn là **numerical guard**, không phải economic parameter. Nếu model thường xuyên chạm floor thì đó là tín hiệu phải xem lại data regime hoặc model fit, không phải lý do để coi floor là một "tham số định giá".
*   **Giải thích tổng hợp:**
    *   Toàn bộ lợi nhuận (mịn và nhảy) qua từng giây được cộng dồn (Cumulative Sum) và mũ hóa (`exp`) để chuyển từ Log-space về lại không gian Giá tuyệt đối (USD).
    *   Kết quả thu được là một ma trận $N \times T$, trong đó $T$ là horizon hiện hành của mode. Với principal mode live runtime, $T = 65$.

#### **Code Snapshot (fortress/engine.py ~L726-L731)**
```python
# Cộng dồn lợi nhuận (cumsum) và cộng với log giá hiện tại
log_paths = np.cumsum(returns, axis=1, dtype=np.float32) + math.log(
    max(price, self.config.epsilon)
)
# Mũ hóa để về giá trị tuyệt đối
price_paths = np.exp(log_paths).astype(np.float32)
```

#### **So sánh 3 chiều (3-Way Comparison: Monte Carlo)**
| Góc nhìn | Giải pháp & Đánh giá |
|---|---|
| **Academic Theory** | Lý thuyết chuẩn dùng Monte Carlo với Continuous GBM ($dt \to 0$) hoặc Euler-Maruyama discretization. |
| **Industry SOTA** | Các quỹ dùng Low-Discrepancy Sequences (Sobol/Halton) kết hợp Stochastic Volatility (Heston) thay vì GBM hằng số. |
| **Sản phẩm (Codebase)** | Chúng ta dùng **GBM + Itô Drag + Pseudo-random Antithetic + bootstrap Hawkes Jumps + Adaptive N**. <br> **Sự đánh đổi (Trade-off):** Dùng $N=5000\to10000$ với Adaptive loop ở core engine giúp quote ổn định hơn, còn evaluator có thể hạ N xuống 400 hoặc 80 để lấy artifact nhanh hơn. Điểm đánh đổi lớn nhất hiện nay không phải Itô hay Antithetic, mà là việc giữ $\sigma$ và $\lambda$ cố định trên toàn horizon MC. |

#### **Next Actions (Monte Carlo)**
1. **Khảo sát Low-Discrepancy Sequence:** Thử nghiệm Sobol thay cho Numpy RNG tiêu chuẩn để xem tốc độ hội tụ có giảm được số Paths cần thiết ($N$) xuống $1000$ không.
2. **Review Jump Bootstrap:** Đảm bảo `JumpSampler` không bị lấy mẫu quá hạn sử dụng (Outdated jumps) khi regime thị trường thay đổi đột ngột.
3. **Forward-state Review (Priority):** Đánh giá xem việc giữ $\sigma$ và $\lambda$ cố định trong suốt horizon có làm under/over-price các window xa hay không, thay vì tiếp tục tập trung vào giả thuyết cũ về `epsilon` floor.

---

## 5. Tầng 5: Brownian Bridge (Cầu Brownian)

> **Luồng Data (Data Flow):** 
> $$ S_t, S_{t+\Delta t}, L, H \xrightarrow{\text{Xác định vị trí tương đối}} \underbrace{\{\text{in-band},\ \text{below},\ \text{above}\}}_{\text{Trạng thái segment}} \xrightarrow[\text{Reflection Principle}]{\text{Chọn biên liên quan}} \zeta \xrightarrow{\text{Gộp theo window}} P_{touch} $$
> 
> **Mô tả tổng quát:**
> Tầng 5 sinh ra để giải quyết bài toán "Bóng ma" trong mô phỏng rời rạc. Khi nhìn vào 2 điểm giá ở đầu giây và cuối giây, hệ thống MC (Tầng 4) không thể biết được trong lúc "nhắm mắt", giá đã giật một râu nến chạm band rồi rút về hay chưa. Dựa trên lý thuyết *Reflection Principle* của *Shreve (2004)*, hệ thống tính xác suất bridge chạm **biên liên quan** của interval trong từng segment 1 giây. Logic hiện tại không phải union của 2 barrier độc lập, mà là **one-sided conditional barrier logic**: nếu cả 2 endpoints cùng ở dưới band thì xét biên dưới $L$; nếu cùng ở trên band thì xét biên trên $H$; nếu một trong 2 endpoint đã nằm trong band thì segment đó được coi là chạm chắc chắn.

### Vấn đề: "Bóng ma" trong thế giới rời rạc (Discrete Ghost Problem)
Khi mô phỏng Monte Carlo ở khung 1 giây, chúng ta chỉ nhìn thấy giá ở điểm đầu ($t=0$) và điểm cuối ($t=1$) của mỗi giây. 
*   Nếu giá đầu giây chưa chạm band giá ($L, H$) và giá cuối giây cũng chưa chạm, thuật toán thông thường sẽ đánh giá xác suất chạm trong giây đó là $0\%$.
*   **Thực tế:** Giá hoàn toàn có thể đã giật lên chạm biên ở mili-giây thứ 500 rồi rút râu về lại vị trí cuối giây. Sự kiện chạm biên vô hình này được gọi là **"Bóng ma"**.

**Nhiệm vụ của Brownian Bridge:** Tính toán xác suất xuất hiện của "Bóng ma" này trong khoảng không gian và thời gian giữa 2 điểm dữ liệu.

---

### 5.1 Nguyên lý Phản chiếu (Reflection Principle)

Để giải quyết bài toán "Bóng ma", toán học tài chính sử dụng Nguyên lý Phản chiếu. Hãy hình dung qua một ví dụ vật lý:

> Bạn đứng trên sàn của một căn phòng có trần nhà cao $H$ (Barrier). Bạn nhắm mắt, ném một quả bóng lên trời, và mở mắt ra thấy quả bóng rơi trở lại tay bạn. Làm sao biết quả bóng có đập trúng trần nhà trong lúc bạn nhắm mắt không?
> 
> **Toán học hóa:** Hãy coi trần nhà là một **chiếc gương**. Bất kỳ quỹ đạo nào của quả bóng vượt qua trần nhà sẽ được chiếc gương phản chiếu ngược lại tạo thành một quỹ đạo ảo bay thẳng lên trên. 
> $\implies$ Số lượng quỹ đạo thực tế chạm trần nhà rồi rớt xuống tay bạn **ĐÚNG BẰNG** số lượng quỹ đạo ảo xuyên thẳng qua trần nhà và kết thúc ở một điểm đối xứng ở tầng trên.

Nguyên lý này cho phép chúng ta chuyển một bài toán khó (Tính xác suất giá chạm biên rồi quay đầu) thành một bài toán cực dễ (Tính xác suất giá kết thúc ở một điểm đối xứng vượt qua biên).

---

### 5.2 Crossing Probability ($\zeta$ - Xác suất chạm 1 biên)

Dựa trên nguyên lý trên, xác suất $\zeta$ để giá có một đường đi (Bridge) nối từ $S_t$ đến $S_{t+\Delta t}$ mà chạm vào biên $B$ ở giữa được chứng minh là:

$$d_1, d_2 \xrightarrow[\text{Khoảng cách và Biến động}]{\text{Xác suất Bóng ma}} \zeta = \exp\left( \underbrace{-\frac{2 d_1 d_2}{\sigma_{final}^2 \Delta t}}_{\text{Độ phạt khoảng cách}} \right)$$

**Bóc tách công thức:**
*   $d_1 = |\ln(S_t / B)|$: Khoảng cách từ giá đầu giây đến biên (tính bằng log-price).
*   $d_2 = |\ln(S_{t+\Delta t} / B)|$: Khoảng cách từ giá cuối giây đến biên.
*   **Tích $d_1 d_2$:** Nếu giá đầu và cuối đều cách rất xa biên, tích này sẽ cực lớn $\implies e^{-\text{Số lớn}} \approx 0$ (Xác suất có bóng ma gần như bằng 0). Nếu giá kết thúc sượt sát mép biên ($d_2 \approx 0$), tích này $\approx 0 \implies e^0 = 1$ (Chắc chắn đã chạm).
*   **Hệ số $-2$:** Phát sinh trực tiếp từ việc nhân đôi hàm mật độ xác suất (PDF) của điểm đối xứng qua chiếc gương (Reflection). Dấu trừ đảm bảo $\zeta \in [0, 1]$.
*   **Mẫu số $\sigma_{final}^2 \Delta t$ (Phương sai):** Biến động càng lớn $\implies$ Mẫu số lớn $\implies$ Toàn bộ phân số tiến về $0 \implies e^0 \approx 1$. Nghĩa là thị trường càng điên rồ, bóng ma càng dễ xuất hiện dù khoảng cách xa.

---

### 5.3 One-Sided Conditional Barrier Logic (Logic một biên có điều kiện)

QTAP đang định giá xác suất **đi vào interval** $[L,H]$ trong từng segment 1 giây. Với semantics này, code hiện tại chọn biên liên quan theo vị trí của 2 endpoints:

*   Nếu $S_t$ hoặc $S_{t+\Delta t}$ đã nằm trong $[L,H]$ $\implies P_{touch}=1$.
*   Nếu cả 2 endpoints đều ở dưới band $\implies$ muốn đi vào interval thì phải vượt qua biên gần nhất là $L$ trước.
*   Nếu cả 2 endpoints đều ở trên band $\implies$ muốn đi vào interval thì phải vượt qua biên gần nhất là $H$ trước.

Nói cách khác, implementation hiện tại là:
$$
P_{touch,u}^{(n)}(c) =
\begin{cases}
1, & S_u^{(n)} \in [L_c,H_c] \text{ hoặc } S_{u+1}^{(n)} \in [L_c,H_c] \\
\zeta_u^{(n)}(L_c), & S_u^{(n)}, S_{u+1}^{(n)} < L_c \\
\zeta_u^{(n)}(H_c), & S_u^{(n)}, S_{u+1}^{(n)} > H_c
\end{cases}
$$

Đây **không phải bug** kiểu “quên trừ $P_{Both}$”, mà là một lựa chọn mô hình hóa: code đang dùng single relevant barrier cho từng trạng thái tương đối của segment. Một nghiệm double-barrier đầy đủ sẽ là một bài toán khác, nặng hơn về toán và hiện chưa phải thứ code đang triển khai.

Trong phần notation của tài liệu, cận trên của band được viết là $H$. Riêng snapshot code bên dưới vẫn giữ tên field `R` vì đó là tên đang tồn tại trong runtime.

#### **Code Snapshot đầy đủ (fortress/engine.py)**
```python
s0 = np.maximum(s0, self.config.epsilon)
s1 = np.maximum(s1, self.config.epsilon)

in_band = (s0 >= L) & (s0 <= R) | (s1 >= L) & (s1 <= R)
below = (s0 < L) & (s1 < L)
above = (s0 > R) & (s1 > R)
p_hit = np.ones_like(s0, dtype=np.float32)

def zeta(x: float) -> np.ndarray:
    num = -2.0 * np.log(x / s0) * np.log(x / s1)
    denom = (sigma * sigma * dt) + self.config.variance_floor
    return np.exp(np.clip(num / denom, None, 0.0))

p_hit[below] = zeta(L)[below]
p_hit[above] = zeta(R)[above]
p_hit[in_band] = 1.0
p_hit = np.clip(p_hit, 0.0, 1.0).astype(np.float32)
```

**Bóc tách từng dòng Code (Vectorization & Boolean Masking):**
*   **Tại sao `p_hit`, `s0`, `s1` là mảng (Array)?** Trong Monte Carlo, chúng ta không chạy 1 đường giá, mà chạy $N = 5000$ đường (paths) song song bằng sức mạnh ma trận của Numpy. Do đó, `s0` và `s1` là các vector chứa 5000 giá trị tương ứng. Kéo theo đó, `p_hit` cũng là một vector 5000 kết quả.
*   **Hiểu đúng về lệnh `p_hit[below] = zeta(L)[below]` (Numpy Masking):** 
    *   Mảng `below` là một bộ lọc (Mask) gồm 5000 giá trị `True/False`.
    *   Câu lệnh này có nghĩa là: *"Chỉ thực hiện phép gán hàm `zeta(L)` vào đúng các vị trí có giá trị `True` trong mảng `below` trên vector `p_hit`"*. 
    *   **Ví dụ:** Đường MC số 42 có `s0` và `s1` đều nằm dưới sàn $L$. Numpy đánh dấu `below[42] = True`. Khi gán, nó tính $\zeta_L$ cho đường 42 và ghi vào `p_hit[42]`. Các vị trí `False` bị bỏ qua.
*   **Tại sao code không tính $P_{Both}$ theo kiểu union 2 biên?**
    *   Vì object hiện tại không phải “2 barrier độc lập rồi union lại”, mà là “xác suất đi vào interval từ đúng phía đang đứng”.
    *   Nếu cả 2 endpoints đều nằm cùng một phía của band, crossing của biên gần nhất đã là điều kiện cần đầu tiên để vào band. Code chốt luôn xác suất trên biên đó.
    *   Điều này giúp logic vectorized rất nhanh và bám khá sát contract semantics hiện hành. Đổi sang double-barrier series chỉ hợp lý khi team thật sự muốn xấp xỉ một object toán học khác.

### 5.4 Từ xác suất segment đến xác suất cell $P_{raw}$

Brownian Bridge chưa phải đích cuối. Nó chỉ cung cấp xác suất chạm ở cấp **segment `1s`**. Để đi tới object định giá thật sự của QTAP, pipeline còn 2 phép gộp nữa:

1.  **Gộp theo window của cùng một path:** Từ xác suất chạm của từng segment `1s`, tính xác suất path $n$ chạm cell $c$ trong toàn bộ window của cell.
2.  **Gộp qua toàn bộ Monte Carlo paths:** Lấy trung bình xác suất path-level đó trên $N_{MC}$ paths để thu được xác suất thô cuối cùng của cell.

#### **Bước 1: Xác suất path-level trong một cell**

Với cell $c$, gọi $\mathcal{W}(c)$ là tập các segment `1s` thuộc window của cell đó. Khi đó:

$$
P^{(n)}(c)=1-\prod_{u\in\mathcal{W}(c)}\left(1-P_{touch,u}^{(n)}(c)\right)
$$

**Giải thích vai trò của từng toán tử:**

*   **$1-P_{touch,u}^{(n)}(c)$:** Xác suất path $n$ **không** chạm cell ở segment $u$.
*   **$\prod_{u\in\mathcal{W}(c)}$:** Nhân tất cả xác suất “không chạm” của các segment trong window.
*   **$1-\prod(\cdot)$:** Đổi từ “không chạm ở mọi segment” sang “chạm ít nhất một lần trong window”.
*   **$P^{(n)}(c)$:** Đây là object đúng để mô tả xác suất one-touch của riêng path $n$ trên toàn bộ contract window của cell.

#### **Bước 2: Trung bình Monte Carlo qua các paths**

Sau khi đã có $P^{(n)}(c)$ cho mọi path:

$$
P_{raw}(c)=\frac{1}{N_{MC}}\sum_{n=1}^{N_{MC}} P^{(n)}(c)
$$

**Giải thích vai trò của từng toán tử:**

*   **$\sum_{n=1}^{N_{MC}}$:** Cộng đóng góp của tất cả paths.
*   **$\frac{1}{N_{MC}}$:** Chia đều để lấy trung bình Monte Carlo.
*   **$P_{raw}(c)$:** Đây là xác suất chạm cell canonical của pipeline pricing. Margin, skew, safety chỉ được áp **sau** đại lượng này.

#### **Ghi chú về tên biến trong mã nguồn**

Trong `fortress/engine.py`, quote hiện trả ra đồng thời:

*   `P_raw_model`: xác suất chạm MC + Brownian Bridge trước các lớp hiệu chỉnh xác suất tùy chọn.
*   `P_raw`: xác suất đi tiếp vào tầng multiplier sau các lớp hiệu chỉnh đó, nếu chúng được bật.

Trong tài liệu này, phần toán học chọn `dP` chỉ dùng **một** ký hiệu là $P_{raw}$ để chỉ **xác suất chạm thô trước margin, skew, safety**. Khi đem công thức xuống code:

*   nếu runtime đang tắt các lớp hiệu chỉnh xác suất, có thể đọc trực tiếp từ `P_raw`;
*   nếu runtime bật các lớp hiệu chỉnh xác suất, biến gần nhất với đối tượng toán học này là `P_raw_model`.

Mục đích của cách viết này là giữ tài liệu gọn và không tạo thêm một lớp ký hiệu chỉ để phản chiếu đúng tên trường trong mã nguồn.

### 5.5 Từ bề mặt xác suất chạm của MC + Brownian Bridge đến quyết định chọn $dP$

#### **5.5.1 Bài toán thực sự là gì**

QTAP không cần tối ưu `dP` trên một miền liên tục. Với principal grid, thứ ta thật sự làm là:

*   chọn `dP` cho **giai đoạn điều hành kế tiếp**,
*   chỉ chọn trong một tập nhỏ các mức hợp lệ,
*   và kiểm tra xem mức đó có còn khớp với hình học của bề mặt xác suất chạm hay không.

Trong bản rút gọn này, tập giá trị hợp lệ là:

$$
\mathcal{D}=\{1,\ 2,\ 2.5,\ 4,\ 5,\ 10,\ 15,\ 20\}\ \text{USD}
$$

Ta resize khi lưới không còn khớp với thị trường:

*   **lưới quá to:** xác suất dồn vào vài hàng giữa, multiplier giữa tụt thấp, người chơi chỉ cần bet quanh spot;
*   **lưới quá nhỏ:** xác suất dạt ra mép, giá dễ chạy sát biên hoặc ra ngoài vùng lưới đang hiển thị.

Nói bằng ngôn ngữ model:

*   **quiet regime / vol thấp** thường đẩy xác suất vào giữa;
*   **fast regime / jumpy regime** thường đẩy xác suất ra mép.

#### **5.5.2 Object đúng của quyết định resize**

Object đúng không phải là `M_final` snapshot, cũng không phải một Gaussian endpoint surrogate. Object đúng vẫn là:

$$
P_{raw}(r,w\mid dP)
$$

tức bề mặt xác suất chạm thô lấy từ chính pipeline:

$$
\text{MC} \rightarrow \text{Brownian Bridge} \rightarrow P_{raw}
$$

Đây là điểm quan trọng nhất của section này:

*   multiplier thấp chỉ là **triệu chứng**;
*   `P_raw` mới là **hình học gốc** cho resize;
*   Brownian Bridge phải được giữ lại vì sản phẩm là **one-touch**, không phải chỉ nhìn endpoint cuối.

#### **5.5.3 Bước 1: lấy một giá trị dP gợi ý từ state hiện tại**

Tại thời điểm quyết định, đọc:

$$
S_t,\qquad \sigma_{final,t},\qquad \lambda_t
$$

Rồi lấy một giá trị khởi đầu:

$$
dP_{seed}=
\operatorname{snap}\!\left(
\mathcal{D},\ \alpha\,S_t\,\sigma_{eff,t}
\right)
$$

Trong đó:

*   **$\operatorname{snap}(\mathcal{D},x)$:** chọn mức gần nhất trong tập $\mathcal{D}$.
*   **$\sigma_{eff,t}$:** mặc định có thể bắt đầu bằng $\sigma_{final,t}$; nếu muốn phản ứng mạnh hơn với jump clustering, có thể inflate nhẹ theo $\lambda_t$.
*   **$\alpha$:** hằng số điều hướng, được hiệu chỉnh từ exact surfaces; nó không phải định lý đóng của object one-touch.

Ý nghĩa rất đơn giản:

*   vol thấp $\rightarrow dP_{seed}$ nhỏ hơn;
*   vol cao $\rightarrow dP_{seed}$ lớn hơn.

Bước này chỉ để **định vị nhanh**. Nó không phải chứng chỉ an toàn cuối cùng.

#### **5.5.4 Bước 2: kiểm tra exact surface ở cửa sổ gần**

Sau khi có `dP_seed`, chạy exact `MC + Brownian Bridge` một lần để lấy:

$$
P_{raw}(r,w\mid dP_{seed})
$$

Chuẩn hóa theo hàng giá:

$$
q_{r,w}(dP)=
\frac{P_{raw}(r,w\mid dP)}
{\sum_i P_{raw}(i,w\mid dP)}
$$

Rồi đo mức tập trung ở giữa tại cửa sổ gần nhất:

$$
C_{near}(dP)=
\sum_{|r-r_{center}|\le 1} q_{r,w_{near}}(dP)
$$

Ý nghĩa vận hành:

*   **$C_{near}$ cao:** quá nhiều xác suất nằm trong 3 hàng giữa;
*   khi đó grid đang **quá thô**;
*   hành động đúng là **giảm `dP` xuống 1 nấc**.

Mốc đọc thực dụng hiện tại:

$$
C_{near}>0.70
$$

tức hơn 70\% xác suất đang dồn vào đúng 3 hàng giữa.

#### **5.5.5 Bước 3: kiểm tra exact surface ở cửa sổ xa**

Với cửa sổ xa nhất, đo áp lực ở mép lưới:

$$
E_{far}(dP)=
\sum_{r\in\mathcal{R}_{edge}(2)} q_{r,w_{far}}(dP)
$$

trong đó $\mathcal{R}_{edge}(2)$ là 2 hàng dưới cùng và 2 hàng trên cùng.

Ý nghĩa vận hành:

*   **$E_{far}$ cao:** xác suất đang dạt ra mép;
*   khi đó grid đang **quá mịn**;
*   hành động đúng là **tăng `dP` lên 1 nấc**.

Mốc đọc thực dụng hiện tại:

$$
E_{far}>0.15
$$

tức hơn 15\% xác suất đã chạm 4 hàng ngoài cùng của bảng.

#### **5.5.6 Bước 4: chặn trường hợp nguy hiểm cho house**

Ngoài 2 tín hiệu hình học trên, còn một chặn an toàn phụ: không để off-center cell nào quá dễ trúng so với floor multiplier hiện hành.

Từ engine hiện tại:

$$
M_{base}(r,w\mid dP)=\frac{1-m_{eff}}{P_{raw}(r,w\mid dP)}
$$

nên ngưỡng đúng là:

$$
P_{floor}^{crit}=\frac{1-m_{eff}}{M_{min}}
$$

Nếu một **off-center bettable cell** có:

$$
P_{raw}(r,w\mid dP)>P_{floor}^{crit}
$$

thì mức `dP` đó là **no-go** cho trạng thái hiện tại.

Điểm cần nhấn mạnh:

*   đây là chặn **an toàn phụ**;
*   nó không thay thế `C_{near}` hay `E_{far}`;
*   nó chỉ chặn trường hợp một cell ngoài giữa trở nên quá dễ trúng so với mức floor quote hiện hành.

#### **5.5.7 Rule cuối cùng**

Resize protocol được rút gọn thành:

```text
1. tính dP_seed từ state hiện tại
2. chạy exact MC + BB cho dP_seed
3. nếu C_near quá cao -> giảm 1 nấc
4. nếu E_far quá cao  -> tăng 1 nấc
5. nếu off-center floor risk xuất hiện -> loại mức đó
6. nếu near đòi giảm còn far đòi tăng -> giữ dP_seed hoặc dP_current và phát cảnh báo
```

Trong trường hợp bình thường, protocol này chỉ cần `1` lần chạy exact surface. Trường hợp biên thì cần `2` lần.

Điều section này **cố ý bỏ khỏi đường quyết định chính**:

*   historical state ensemble cho mỗi lần resize,
*   entropy objective,
*   continuous optimization rồi snapping,
*   CVaR cho từng lần chọn `dP`.

Nếu cần một lớp solvency sâu hơn, CVaR nên là **lớp kiểm tra định kỳ riêng** trên liability thật hoặc stress path riêng, không phải bước bắt buộc mỗi lần ra quyết định `dP`.

#### **5.5.8 Re-check và semantics khi đổi grid**

`dP` không nên đổi liên tục mỗi tick. Nó được giữ trong một khoảng thời gian điều hành rồi mới đánh giá lại; nếu cần đánh giá sớm, có thể re-run ngay khi:

*   $\sigma_{final,t}$ đổi mạnh so với lúc chốt `dP`,
*   $\lambda_t$ tăng vọt,
*   hoặc live quote bắt đầu cho thấy cụm giữa / áp lực mép vượt ngưỡng.

Khi đổi `dP`, **không được mutate grid đang có open bets**. Lý do là:

*   `cell_id` hiện gắn với geometry cũ;
*   liability book cũng gắn với `cell_id`;
*   đổi `dP` tại chỗ sẽ làm sai settlement và liability accounting.

Vì vậy semantics đúng là:

1.  mode cũ tiếp tục settle các cược đã khóa;
2.  mode mới nhận cược mới với `dP` mới;
3.  chỉ retire mode cũ khi không còn liability mở.

**Vai trò thực tiễn của Tầng 5:**
Brownian Bridge giúp pipeline không đếm touch theo kiểu nhị phân tại đúng điểm cuối mỗi giây. Thay vào đó, mỗi bước MC `1s` được gán một xác suất chạm nằm trong đoạn nối giữa hai endpoint. Nhờ vậy, bề mặt $P_{raw}$ bám sát ý nghĩa one-touch hơn, đặc biệt khi giá đi sát mép band rồi quay lại ngay trong nội bộ một giây.

#### **So sánh 3 chiều (3-Way Comparison: Brownian Bridge)**
| Góc nhìn | Giải pháp & Đánh giá |
|---|---|
| **Academic Theory** | Công thức gốc của Shreve (2004) dùng Continuous Bridge cho Single Barrier. Interval-hit hoặc double-barrier chính xác hơn có thể cần chuỗi vô hạn, PDE, hoặc mô phỏng dày hơn. |
| **Industry SOTA** | Các ngân hàng đầu tư định giá Barrier Options bằng chuỗi vô hạn cắt cụt (Truncated Series) hoặc Finite Difference Methods (PDE) để có nghiệm chính xác tuyệt đối. |
| **Sản phẩm (Codebase)** | Codebase đang dùng **one-sided conditional bridge** theo vị trí tương đối của segment. <br> **Đánh đổi (Trade-off):** Nhanh, dễ vectorize, và bám sát logic "đi vào band từ phía đang đứng". Hạn chế là đây vẫn chỉ là approximation dựa trên Brownian Bridge giữa 2 endpoints 1 giây, chưa phải nghiệm interval-hit đầy đủ. |

#### **Next Actions (Brownian Bridge)**
1. **Review semantics trước khi nâng cấp toán:** Chỉ nên chuyển sang double-barrier đầy đủ nếu team thật sự muốn thay đổi object định giá, không phải chỉ vì thấy công thức union nhìn “đẹp” hơn.
2. **Review Tốc độ numpy:** Đoạn hàm `zeta(x)` có thể dùng Numba JIT hoặc C++ extension nếu Brownian Bridge trở thành nút thắt hiệu năng.

---

## 6. Tầng 6: Effective Margin (Phí biên động)

> **Luồng Data chi tiết (Detailed Data Flow):** 
> 
> $$ \underbrace{\sigma_{final}, \lambda_{t+1}}_{\text{Trạng thái thị trường}} \xrightarrow[\text{Standardize}]{\text{Chia tham chiếu}} \underbrace{\frac{\sigma_{final}}{\sigma_{ref}}, \frac{\lambda_{t+1}}{\lambda_{ref}}}_{\text{Tỷ lệ rủi ro thô}} \xrightarrow[\text{Threshold}]{\text{Trừ 1, lấy Max 0}} \underbrace{\sigma_{ratio}, \lambda_{ratio}}_{\text{Hệ số vượt ngưỡng}} \xrightarrow[\text{Weight } a]{\text{Khuếch đại}} \underbrace{m_{risk}}_{\text{Phí rủi ro}} \xrightarrow[\text{Add } m_{base}]{\text{Chốt Margin}} m_{eff} $$

**Mô tả tổng quát:** Tầng này chuyển đổi trạng thái biến động của thị trường thành một mức phí bảo hiểm (Margin). Đầu tiên, Volatility ($\sigma_{final}$) và Hawkes Intensity ($\lambda_{t+1}$) được chuẩn hóa bằng các mốc tham chiếu an toàn ($\sigma_{ref} = 3 \times 10^{-5}, \lambda_{ref} = 0.1$) để đo lường mức độ "bất thường". Các tỷ lệ vượt ngưỡng này sau đó được khuếch đại bởi các trọng số nhạy cảm hiện tại ($a_\sigma = 0.70, a_\lambda = 0.35$) để tạo thành phí rủi ro động ($m_{risk}$). Cuối cùng, phí rủi ro được cộng với phí nền ($m_{base}$) và kẹp trong một biên độ an toàn để tạo ra Margin hiệu dụng ($m_{eff}$), trực tiếp tham gia vào việc định giá ở tầng sau.

Trong tài chính, Margin ($m_{eff}$) chính là "Edge" (lợi thế) của nhà cái. Nó đảm bảo rằng kỳ vọng lợi nhuận lâu dài của Player luôn $< 0$, giúp sàn bù đắp chi phí vận hành và rủi ro bị "bắn tỉa".

### 6.1 Mức phí nền ($m_{base}$)
*   **Giá trị hiện tại:** $0.022$ cho principal mode nội bộ (`mode_id="5"`), $0.045$ cho mode `50`, và $0.06$ cho mode `100`.
*   **Cơ sở Fundamental:** Tương đương với **Bid-Ask Spread** trong các sàn phái sinh. 
    *   **Thị trường truyền thống:** Sàn CME/CBOE có spread ngầm $\approx 0.1\% - 0.5\%$. 
    *   **Crypto Perps:** Funding rate và Spread cộng dồn thường tạo ra rủi ro $\approx 1\% - 2\%$ mỗi ngày cho Market Maker.
    *   **QTAP Adaptation:** Vì timeframe 1s có độ nhiễu cực cao, $m_{base}$ phải đủ lớn để chống lại các bot High-frequency có thể tận dụng độ trễ API (Latency Arbitrage).
*   **Biến thiên theo horizon & Grid:**
    *   **Tỷ lệ thuận với độ khó:** Lead time càng dài (Mode 100) hoặc lưới càng rộng $\implies$ House cần Margin cao hơn để bù đắp sai số dự báo dài hạn.
    *   **Micro-horizon:** Nếu hạ xuống lưới $\$5$, $m_{base}$ nên được giữ đủ thấp để duy trì tần suất cược (Turnover), nhưng vẫn phải chặn các strategy cơ bản có EV dương.

### 6.2 Phí rủi ro động ($m_{risk}$)
Hệ thống tăng margin khi trạng thái thị trường vượt mốc tham chiếu: $\sigma_{final}$ đo mức dao động nền, còn $\lambda_{t+1}$ đo mức clustering của rare moves.

*   **Công thức Chuẩn (Toán học):**
    $$ m_{risk} = \underbrace{a_\sigma \cdot \max\left(0, \frac{\sigma_{final}}{\sigma_{ref}} - 1\right)}_{\text{Volatility Premium}} + \underbrace{a_\lambda \cdot \max\left(0, \frac{\lambda_{t+1}}{\lambda_{ref}} - 1\right)}_{\text{Jump Clustering Premium}} $$
*   **Gốc học thuật (Fundamental):** Tầng này dùng trực giác jump-diffusion kết hợp Hawkes: biến động khuếch tán đo nền dao động liên tục, còn Hawkes intensity đo cụm jump tự kích hoạt theo thời gian.
    *   **$\sigma_{ref} = 3 \times 10^{-5}$:** Đây là mỏ neo thực nghiệm cho BTC/USDT ở khung 1s, không phải hằng số cấu trúc. Kiểm tra thang đo từ annualized volatility cho thấy nếu BTC có biến động năm quanh $50\%$, phép hạ bậc theo căn thời gian cho mức tổng biến động 1s khoảng $\sigma_{1s} \approx 0.50/\sqrt{31{,}536{,}000} \approx 8.9 \times 10^{-5}$. Vì pipeline dùng close-to-close EWMA cho phần nền và tách cụm rare-move sang Hawkes, anchor vận hành được đặt thấp hơn. Calibration sweep nội bộ chọn $3 \times 10^{-5}$ vì nó đưa $\sigma_{final}/\sigma_{ref}$ vào vùng active nhưng chưa bão hòa.
    *   **$\lambda_{ref} = 0.1\,\mathrm{s}^{-1}$:** Đây là mỏ neo thực nghiệm cho jump clustering. Với đơn vị event/second, $\lambda=0.1$ nghĩa là kỳ vọng 1 jump trên 10 nến 1s. Khi đưa vào MC qua $q=1-\exp(-\lambda\Delta t)$, mức này tương đương $q\approx9.5\%$ cho mỗi bước 1s; nếu giữ intensity cố định trong cell 5s, xác suất có ít nhất một jump là $1-\exp(-0.5)\approx39.3\%$.
*   **Crypto Adaptation:** QTAP cập nhật Hawkes intensity theo từng giây, nên phí rủi ro có thể phản ứng ngay khi rare-move clustering tăng, thay vì chỉ chờ các mô hình biến động chậm hơn tích lũy đủ mẫu sau sự kiện.
*   **Range giá trị:**
    *   **Min:** $0.0$ (Thị trường tĩnh lặng).
    *   **Max:** Được chặn bởi $m_{risk\_max} = 0.025$ (2.5%). Tức là phần phí rủi ro động không vượt quá 2.5%; tổng margin tối đa phụ thuộc vào $m_{base}$ của từng mode.
*   **Phân tích $a_\sigma, a_\lambda$ (Sensitivity Weights):**
    *   **Bản chất:** Đây là các trọng số vận hành/hiệu chỉnh, không phải hằng số vật lý.
    *   **Giá trị hiện tại trong code:** $a_\sigma = 0.70$, $a_\lambda = 0.35$.
    *   **Giải thích:** Volatility surcharge đang được đặt nặng hơn jump-intensity surcharge, nghĩa là house coi "mặt bằng dao động tăng rộng" là tín hiệu đáng thu phí hơn so với chỉ riêng việc $\lambda$ tăng.
*   **Cập nhật SSOT:** Cảnh báo bug cũ “code đang nhân thừa thêm $\sigma$ vào $a_\sigma$” không còn đúng. Công thức hiện tại trong `fortress/engine.py` đã dùng đúng dạng dimensionless theo tỷ lệ vượt ngưỡng.

### 6.3 Chốt Margin ($m_{eff}$)
*   **Công thức:** $m_{eff} = m_{base} + \min(m_{risk}, m_{risk\_max})$.
*   **Ý nghĩa kinh doanh:** Đây là bước chuyển đổi từ **Trạng thái thị trường** sang **Lợi nhuận kỳ vọng**. Margin này sẽ được dùng để chiết khấu trực tiếp vào hệ số nhân ở Tầng 7.

#### **Code Snapshot (fortress/engine.py ~L851-L865)**
```python
sigma_term = max(0.0, sigma / max(self.config.sigma_ref, self.config.epsilon) - 1.0)
lambda_term = max(0.0, lambda_intensity / max(self.config.lambda_ref, self.config.epsilon) - 1.0)

m_risk = self.config.a_sigma * sigma_term + self.config.a_lambda * lambda_term
m_risk = self._clamp(m_risk, 0.0, mode.m_risk_max)
m_eff = mode.m_base + m_risk
```

---

## 7. Tầng 7: Multiplier Construction (Định giá hệ số nhân)

> **Luồng Data (Data Flow):** 
> $$ P_{raw}, m_{eff} \xrightarrow{\text{Margin Discount}} M_{eff} \xrightarrow{\text{Liquidity}} K_{skew} \xrightarrow{\text{CVaR Check}} K_{safety} \xrightarrow{\text{Final Price}} M_{final} $$

**Mô tả tổng quát:** Đây là khâu "đóng gói" sản phẩm cuối cùng, nơi các xác suất toán học trừu tượng trở thành tỷ lệ cược thực tế. Tầng này thực hiện 3 bước điều chỉnh quan trọng: (1) Chiết khấu Margin để đảm bảo lợi nhuận kỳ vọng cho House. (2) Áp dụng cơ chế trượt giá (Slippage) theo thanh khoản ô cược ($K_{skew}$) để cân bằng dòng tiền, tránh tập trung rủi ro. (3) Kiểm tra khả năng chi trả (Solvency) bằng phương pháp CVaR ($K_{safety}$) để ngăn chặn sự cố hệ thống khi gặp kịch bản "Thiên nga đen". Kết quả là một bộ Multipliers đã được tối ưu hóa cho cả trải nghiệm người chơi và an toàn tài chính của sàn.

**⚠️ CẢNH BÁO KIỂM CHỨNG (Backtesting Gap):**
Các cơ chế quản trị rủi ro tại Tầng 7 ($K_{skew}, K_{safety}$) **đã thực sự chạy trong code**, nhưng phần lớn artifact backtest hiện tại dùng stake nhỏ cố định ($stake = 10.0$), nên chúng thường không bị stress mạnh. Vì vậy, không nên gọi tầng này là “chỉ có lý thuyết”, nhưng cũng chưa nên coi nó đã được verify đầy đủ dưới áp lực inventory lớn.

### 7.1 Hệ số nhân sau margin ($M_{eff}$)
*   **Paper notation:** Uppercase $M$ dùng cho multiplier, lowercase $m$ dùng cho margin fraction nội bộ. Vì vậy luồng paper nên đọc là:
    $$M_{fair}=\frac{1}{P_{raw}},\qquad M_{eff}=\frac{1-m_{eff}}{P_{raw}},\qquad M_{final}=\operatorname{clamp}(M_{eff}\cdot K_{skew}\cdot K_{safety},M_{min},M_{max}).$$
*   **Code nuance:** Engine hiện vẫn ghi field `M_base` cho giá trị $\frac{1-m_{eff}}{P_{raw}}$. Trong paper, gọi đại lượng này là $M_{eff}$ rõ hơn vì nó đã chứa effective margin.
*   **Bản chất:** $M_{fair}$ là inverse-probability multiplier trước margin; $M_{eff}$ là multiplier đã chiết khấu margin nhưng chưa qua inventory/solvency overlays.

### 7.2 Quản trị rủi ro thanh khoản lệch ($K_{skew}$)
*   **Công thức QTAP:** $K_{skew} = \frac{1}{1 + \beta_{skew} \left( \frac{L_{used}}{C_{pool}} \right)}$.
*   **Gốc học thuật (Fundamental):** Dựa trên mô hình **Avellaneda-Stoikov (2008)** về quản trị kho hàng (Inventory Risk) trong Market Making. 
    *   *Lý thuyết gốc:* Nhà cái hiệu chỉnh giá mua/bán (spread) theo vị thế $q$ đang nắm giữ để tự phòng vệ: $r = s - q \gamma \sigma^2 (T-t)$. 
    *   *Giải thích công thức gốc:*
        *   $r$: Reservation price (Giá chào nội bộ của Market Maker).
        *   $s$: Mid-price (Giá thị trường hiện tại).
        *   $q$: Inventory position (Vị thế kho hàng đang ôm).
        *   $\gamma$: Risk aversion parameter (Hệ số nhạy cảm/sợ rủi ro của nhà cái).
        *   $\sigma^2$: Variance (Phương sai của tài sản). Tại sao bình phương? Vì rủi ro trong tài chính định lượng bằng phương sai.
        *   $(T-t)$: Thời gian còn lại đến cuối phiên. Rủi ro cầm hàng qua đêm giảm khi gần cuối phiên.
        *   *Phép trừ và phép nhân:* Nếu MM đang cầm nhiều hàng ($q > 0$), họ muốn xả bớt nên phải hạ giá $r$ xuống ($s - \dots$). Mức hạ giá này tỷ lệ thuận với lượng hàng ($q$), mức rủi ro ($\sigma^2$) và thời gian chịu đựng rủi ro ($T-t$).
*   **Sự khác biệt & Crypto Adaptation:**
    1.  **Từ Tuyến tính sang Hyperbolic:** Mô hình Avellaneda trừ đi một lượng tuyến tính ($q \cdot \dots$), có thể khiến giá $r$ rơi xuống âm. Trong Crypto Prediction Market, rủi ro vỡ nợ tăng theo hàm mũ. QTAP sử dụng hàm phân thức Hyperbolic ($f(x) = 1/(1+\beta x)$) tương tự như các **Bonding Curve** trong DeFi.
        *   *Tác dụng của phép chia:* Hàm này tạo ra đường cong lồi (Convex). Ở những lệnh đầu tiên, giá tụt rất mạnh (chống Sniper), nhưng khi cạn Pool, giá giảm chậm lại tiệm cận về 0 và **không bao giờ bị âm** $\implies$ Đảm bảo Multiplier luôn hợp lệ.
    2.  **Dữ liệu OHLCV 1s:** Do contract horizon của principal mode nằm trong vùng micro-horizon, chúng ta bỏ qua thành phần thời gian dài hạn $(T-t)$ của market-making cổ điển và tập trung 100% vào **Utilization Ratio** (Tỷ lệ lấp đầy thanh khoản $\frac{L_{used}}{C_{pool}}$). Phép chia này đưa rủi ro từ đơn vị tuyệt đối ($) về đơn vị tương đối (%), giúp công thức hoạt động chuẩn xác bất chấp quy mô của quỹ sàn (Scale-invariant).
*   **Tham số thực tế trong code hiện tại, không phải khuyến nghị của paper:**
    *   $L_{used}$ [$]: Biến số động (State). Tổng tiền House phải trả nếu ô thắng (Liability). Đây chính là tương đương với $q$ trong mô hình gốc.
    *   $C_{pool} = 5000.0$ [$]: **Solvency Threshold (Bucket C)** trong snapshot code hiện tại. Đây là thông số điều hành theo vốn khả dụng và cách protocol phân bổ sức chịu đựng theo cell, không phải con số paper khuyến nghị.
    *   $\beta_{skew} = 4.0$ [1]: **Slippage Sensitivity (Bucket C)** trong snapshot code hiện tại, tương đương với $\gamma$ trong mô hình gốc. Giá trị này phải được tune theo khẩu vị rủi ro và UX target của protocol; paper chỉ mô tả vai trò của tham số, không recommend range.
*   **Tình trạng:** Đã code, chưa có dữ liệu verify mức độ ảnh hưởng lên hành vi người chơi.

### 7.3 Quản trị rủi ro đuôi ($K_{safety}$ - CVaR)
*   **Công thức QTAP:** $K_{safety} = \min\left(1.0, \frac{\text{Risk\_Budget}}{\text{CVaR}_{99}}\right)$.
*   **Gốc học thuật (Fundamental):** Tiêu chuẩn **Expected Shortfall (CVaR)** theo hiệp ước **Basel III (2019)**.
    *   *Lý thuyết gốc:* Tính trung bình tổn thất trong vùng đuôi nguy hiểm vượt quá ngưỡng VaR: $CVaR_\alpha(X) = \frac{1}{1-\alpha} \int_\alpha^1 VaR_u(X) du$.
    *   *Môi trường:* Ngân hàng thương mại, timeframe 10 ngày.
*   **Sự khác biệt & Crypto Adaptation:**
    1.  **Timeframe 10 ngày vs 1 giây:** Basel III dùng cho rủi ro hệ thống dài hạn. QTAP áp dụng cho sự sống còn của sàn trong **từng giây**. Dữ liệu crypto 1s có độ nhọn (Kurtosis) cực cao do bot thanh lý, khiến VaR thông thường trở nên vô dụng.
    2.  **Bắt Fat-tails:** CVaR 99% bắt được **mức độ nghiêm trọng** của các cú sập (từ Hawkes MC) chứ không chỉ xác suất xảy ra.
    3.  **Tính Coherence (Sub-additivity):** CVaR đảm bảo tổng rủi ro của toàn Grid 120 ô luôn nhỏ hơn hoặc bằng tổng rủi ro của từng ô cộng lại. Điều này giúp House quản trị danh mục cược mà không sợ sai số cộng dồn.
*   **Tham số thực tế trong code hiện tại, không phải khuyến nghị của paper:**
    *   $\text{CVaR}_{99}$ [$]: Kết quả từ 1% đuôi của phân phối Payouts.
    *   $\text{Risk\_Budget}_{base} = 50,000.0$ [$]: Base budget trong snapshot `default_modes()`, không phải con số paper khuyến nghị.
    *   **Live nuance quan trọng:** `fortress/service.py` còn áp một trần động:
        $$\text{Risk\_Budget}_{live} = \min(\text{Risk\_Budget}_{base},\ 0.25 \times \text{House Balance})$$
        $\implies$ Con số `50,000` là **trần cấu hình**, không phải cam kết rằng live runtime lúc nào cũng mang đúng `50,000` đi pricing.

#### **Code Snapshot (fortress/service.py)**
```python
self._risk_budget_ratio = 0.25

def _update_risk_budget(self) -> None:
    cap = self._house_balance * self._risk_budget_ratio
    for mode_id, mode in self._engine.modes.items():
        base = self._base_risk_budget.get(mode_id, mode.risk_budget)
        mode.risk_budget = min(base, cap)
```

### 7.4 Chốt Multiplier ($M_{final}$)
*   **Công thức:** $M_{final} = \text{clamp}(M_{eff} \cdot K_{skew} \cdot K_{safety}, \quad M_{min}, M_{max})$.
*   **Tham số chặn (Bucket B, code default hiện tại, không phải khuyến nghị của paper):**
    *   $M_{min} = 1.05x$: Code default hiện tại cho multiplier floor.
    *   $M_{max} = 25.0x$: Code default hiện tại cho multiplier cap.

#### **Code Snapshot (fortress/engine.py ~L470-L480)**
```python
# K_skew: Giảm giá nếu ô cược (liability) đang quá tải so với Pool Cap
k_skew = 1.0 / (1.0 + mode.beta_skew * (l_used / max(mode.pool_cap, self.config.epsilon)))

# Tính M_final tổng hợp cả 3 yếu tố và kẹp trong biên [1.05, 25.0]
m_final = self._clamp(m_base * k_skew * k_safety, mode.m_min, mode.m_max)
```

#### **So sánh 3 chiều (Risk Management)**
| Góc nhìn | Giải pháp & Đánh giá |
|---|---|
| **Academic** | Dùng **Inventory Models (Avellaneda-Stoikov)** cho Skew và **Extreme Value Theory (EVT)** cho CVaR. |
| **Industry SOTA** | AMM (Hyperliquid) dùng Funding Rate và **Insurance Fund** thay vì bóp Multiplier trực tiếp. |
| **Sản phẩm (Codebase)** | Dùng **Penalty Multiplier ($K_{skew}$)** + **CVaR Solvency Check**. <br> **Phê phán:** Đây là cách tiếp cận "phòng thủ" chủ động (Active defense). Ưu điểm là bảo vệ sàn tuyệt đối, nhược điểm là làm trải nghiệm người chơi bị gián đoạn (Multiplier tụt nhanh) nếu không có hệ thống cân bằng dòng tiền (Arbitrageurs). |

---

## 8. Phụ lục: Hạ tầng Backtesting Canonical

> **Luồng Data (Data Flow):**
> $$ \text{OHLCV}_{1s} \xrightarrow{\text{update\_oracle}} (\sigma_t, \lambda_t, S_t) \xrightarrow{\text{direct engine pricing}} P_{raw,t}(c) \xrightarrow{\text{margin \& skew}} M_{final,t}(c) $$

Canonical runtime và canonical evaluator hiện dùng cùng một semantics: dữ liệu vào là OHLCV `1s`, oracle/grid state cập nhật ở `1s`, Monte Carlo path step là `1s`, và quote surface được tính trực tiếp từ engine tại mỗi tick đánh giá. Không còn lớp `frozen quotes -> quote refresh` trong path chính.

### 8.1 Direct 1s Quote Stream
*   **Oracle cadence:** `engine.update_oracle(...)` chạy ở `1s`.
*   **Pricing cadence:** canonical runtime/evaluation gọi direct quote pass ở `1s`.
*   **Settlement evidence:** window thắng/thua vẫn được kiểm tra bằng historical `1s` high/low.
*   **Remaining horizon semantics:** quote phải được hiểu bằng `remaining_T_start = T_start - oracle_second` và `remaining_T_end = T_end - oracle_second`.

Điều quan trọng là: cell geometry tuyệt đối (`L/H` trong notation tài liệu, `L/R` trong field names của code; cùng với `T_start/T_end`) vẫn là SSOT. Nếu một cell tuyệt đối ban đầu là `[10,15]`, thì khi thời gian chạy sang tick kế tiếp, remaining horizon của chính cell đó phải thành `[9,14]`, rồi `[8,13]`, rồi `[4,9]`; không được suy luận ngược từ static bucket identity.

![Backtest framework flow](architecture/externals/whitepaper/img/generated/tapl_backtest_flow.png)

### 8.2 Các override quan trọng của evaluator
*   `Mode5EvaluationConfig` là config canonical của evaluator hiện tại.
*   Các default quan trọng:
    *   `mc_n_override = 400`
    *   `parkinson_weight = 0.0`
    *   `use_price_scaling = False`
    *   `calibrate_p = False`
    *   `calibration_ticks = 0`
*   **Insight SSOT:** Đây là default của evaluator canonical, không phải lời biện hộ cho bất kỳ lớp quote-refresh hay time-decay nào.
*   **Live runtime nuance:** runtime path trong `fortress/service.py` cũng mặc định để calibration tắt và pricing trực tiếp từ engine; không còn env toggle canonical cho calibration hay empirical model path.

### 8.3 Exact Quote Tape
Artifact persist hiện tại là **exact per-tick quote tape**. Nó lưu quote stream trực tiếp của bề mặt quote tại từng tick, kèm oracle snapshot. Quote tape này phù hợp cho:
*   strategy replay trên fixed quote stream
*   cached artifact cho framework validation
*   paper/debug artifacts

Quote tape này **không** đại diện cho full liability-sensitive house dynamics. Shared-book stress và bất kỳ path nào cần liability feedback nội bộ phải chạy exact path riêng.

---

## 9. Quant Review: Rà soát "Độc tố" (Fudge Factors)

### 9.1 Vấn nạn "Chặn đáy" Epsilon ($\epsilon$) và Sigma Scale ($s_{mode}$)
*   **Tham số trong Code hiện tại:** $\epsilon = 10^{-12}$ (`GlobalConfig.epsilon`), `variance_floor = 10^{-18}`, `sigma_scale = 0.05`.
*   **Phân vai đúng bản chất:**
    *   `epsilon` dùng cho **log/division/probability guard**.
    *   `variance_floor` dùng cho **variance/sqrt/bridge denominator guard**.
    *   `sigma_scale` là **legacy scaling knob**, nhưng mặc định đang dormant vì `use_sigma_scaling = False`.
*   **Insight cập nhật:** Lập luận cũ “epsilon đang chặn đáy variance rồi buộc phải đẻ thêm `sigma_scale` để chữa cháy” không còn khớp với code hiện tại. Phiên bản hiện nay đã tách numeric guard theo đúng đơn vị:
    *   guard cho variance
    *   guard cho log/division
    *   guard cho scaling toggle
*   **Điểm vẫn cần hoài nghi:** Dù các guard đã sạch hơn nhiều, chúng vẫn là lớp bảo vệ số học. Nếu một regime làm model chạm floor liên tục, cần xem đó là tín hiệu cảnh báo data/model mismatch chứ không được tự động diễn giải thành alpha.

---

## 10. Whitepaper Updates (Các điểm cần điều chỉnh so với Paper cũ)

### 10.1 Bổ sung Itô Drag Correction
*   **Trạng thái Paper cũ:** Không đề cập. Công thức mô phỏng MC chỉ là `exp(sigma * eps + J)`.
*   **Thực tế Codebase:** Đã được sửa lỗi ở Phase 2 (thêm `-0.5 * sigma^2`).

---

## 11. Master Bucket & Parameter Reference (Bảng tra cứu tổng hợp)

| Tham số | Ký hiệu | Giá trị hiện tại | Đơn vị | Bucket | Nguồn gốc / Vai trò | Chiến lược Training |
|---|---|---|---|---|---|---|
| **Itô Drag** | $-0.5$ | $-0.5$ | [1] | **A** | Lý thuyết Itô | **Bất biến.** |
| **Reflection** | $-2$ | $-2$ | [1] | **A** | Reflection Princ. | **Bất biến.** |
| **Log-base** | $e$ | $\approx 2.718$ | [1] | **A** | Toán học tự nhiên | **Bất biến.** |
| **Window** | $\Delta T$ | $5.0$ | [s] | **B** | Product Design | **Verify.** Quan sát UX. |
| **Half-life** | $h$ | $20.0$ | [s] | **B** | Heuristic | **Sweep.** 15s, 20s, 30s. |
| **Jump base threshold** | $\kappa_0$ | $3.1$ | [std] | **B** | Adaptive jump threshold | **Verify.** Đo mật độ Jump. |
| **Jump threshold exponent** | $\kappa_q$ | $0.5$ | [1] | **B** | Co giãn theo regime vol | **Verify.** |
| **Jump threshold clamp** | $\kappa_{min/max}$ | $2.7 / 6.0$ | [std] | **B** | Chặn detector | **Verify.** |
| **Min/Max Mult**| $M_{min/max}$ | $1.05/25.0$ | [1] | **B** | Product Limits | **Bất biến.** Theo thiết kế Game. |
| **Margin Base** | $m_{base}$ | $0.022 / 0.045 / 0.060$ | [1] | **B** | Principal / 50 / 100 modes | **Verify.** So sánh đối thủ. |
| **Margin Risk Max**| $m_{risk,max}$| $0.025$ | [1] | **B** | Solvency Cap | **Bất biến.** Bảo vệ UX. |
| **Sigma Scale**| $s_{mode}$ | $0.05$ | [1] | **C** | Empirical knob, dormant khi toggle tắt | **Chỉ train nếu bật path này.** |
| **Hawkes Alpha**| $\alpha_{hawkes}$ | $0.18$ | [1] | **C** | Tự kích hoạt | **Priority 2.** Đo xác suất Jump kép. |
| **Hawkes Beta** | $\beta$ | $0.45$ | [1/s] | **C** | Phân rã hoảng loạn | **Priority 2.** Recovery time. |
| **Price Ref** | $S_{ref}$ | $100,000$ | [$] | **C** | Chỉ dùng khi bật price scaling | **Calibration.** |
| **Price scale floor / clamp** |  | $10,000$ / $[0.7,1.3]$ | [$] / [1] | **C** | Guardrail cho price scaling | **Chỉ có ý nghĩa nếu bật path này.** |
| **Sensitivity Vol**| $a_\sigma$ | $0.70$ | [1] | **C** | Phạt biến động | **Train.** Grid search [0.1, 1.0]. |
| **Sensitivity Hawkes**| $a_\lambda$ | $0.35$ | [1] | **C** | Phạt hoảng loạn | **Train.** Grid search [0.1, 1.0]. |
| **Pool Cap** | $C_{pool}$ | $5000.0$ | [$] | **C** | Sức chứa ô cược | **Calibration.** Real liquidity. |
| **Risk Budget** | $R_{budget}$ | `50000.0 base`, live dùng `min(base, 0.25 × house_balance)` | [$] | **C** | Ngân sách rủi ro + live cap | **Calibration.** Theo Balance. |
| **Skew Sens.** | $\beta_{skew}$ | $4.0$ | [1] | **C** | Độ nhạy trượt giá | **Train.** Tránh tập trung lệnh. |
| **EWMA Decay** | $\alpha_{vol}$ | $\approx 0.966$ | [1] | **B** | Phân rã Vol | **Verify.** Half-life 20s. |
| **Parkinson W**| $w_P$ | `0.0` | [1] | **Infra** | Range-blend weight; main path disabled | **Không train trong paper path.** Chỉ bật cho ablation rõ nhãn. |
| **Epsilon** | $\epsilon$ | $10^{-12}$ | [1] | **Infra** | Guard cho log/division/probability | **Giữ nhỏ, không train như alpha.** |
| **Variance Floor** |  | $10^{-18}$ | [1] | **Infra** | Guard cho variance và bridge denom | **Giữ nhỏ, không train như alpha.** |
| **Dist Gamma**| $\gamma$ | $0.0$ | [1] | **Fudge** | Layer shaping đã tắt | **Giữ disabled trừ khi có case rõ ràng.** |
| **Logit Shift**| shift | $0.0$ | [1] | **Fudge** | Zone shift mặc định tắt ở principal mode | **Giữ disabled.** |
| **Age Penalty**| penalty | `disabled` | [1] | **Legacy** | Removed from canonical pricing/evaluation path | **Không dùng trong SSOT.** |

### Chú thích đơn vị:
*   `[1]`: Không thứ nguyên.
*   `[s]`: Giây.
*   `[$]`: Đô la Mỹ.
*   `[std]`: Độ lệch chuẩn.
*   `[1/s]`: Tốc độ phân rã.

### Phân loại Bucket:
*   **Loại A (Lý thuyết):** Chắc chắn 100%. Sai lệch là sai lệch khoa học.
*   **Loại B (Dự cảm mạnh - Heuristic):** Chắc chắn ~70%. Dựa trên kinh nghiệm và tiêu chuẩn ngành. Cần quan sát định kỳ.
*   **Loại C (Thực nghiệm - Empirical):** Chắc chắn < 40%. Đây là các tham số "mềm", phụ thuộc hoàn toàn vào Calibration và dữ liệu thị trường cụ thể.
*   **Loại Fudge (Độc tố):** Các tham số nhân tạo bóp méo xác suất. Mục tiêu là loại bỏ hoàn toàn hoặc thay thế bằng cơ chế định giá chuẩn mực.
*   **Infra:** Tham số hạ tầng Backtest/Simulation. Không thuộc model chính.


---

## 12. So sánh Implementation vs. Lý thuyết (Gap Analysis)

Dưới đây là bảng đối chiếu mức độ lệch pha giữa mô hình lý thuyết (Academic/Whitepaper) và thực tế triển khai trong Codebase (`fortress/`).

| Tầng | Thành phần | Lý thuyết chuẩn | Triển khai thực tế | Độ lệch (Delta) | Lý do / Hệ quả |
|---|---|---|---|---|---|
| **2** | **Volatility** | Close-to-close core ở 1s | Main defaults đã để `parkinson_weight=0.0`; knob range-blend còn lại cho ablation | **Thấp** | Paper path không dùng range-blend như nguyên lý mặc định. |
| **3** | **Hawkes** | Liên tục (Continuous) | Rời rạc 1 giây (Discrete) | **Trung bình** | Có thể Underprice nếu có $>1$ jump trong 1s. |
| **4** | **Itô Drag** | Phải có (Bù sai số lồi) | Đã có trong Code | **0** | Đảm bảo tính Martingale cho Monte Carlo. |
| **4** | **Forward state dynamics** | Có thể evolve $\sigma,\lambda$ theo từng bước | Giữ $\sigma,\lambda$ cố định trong toàn horizon MC | **Trung bình** | Đây là short-horizon approximation hiện hành. |
| **5** | **B. Bridge** | Single barrier exact; interval-hit đầy đủ có thể phức tạp hơn | One-sided conditional bridge theo vị trí endpoints | **Trung bình** | Bám semantics hiện tại, nhưng vẫn là approximation giữa 2 endpoints 1s. |
| **6** | **Margin** | $a_\sigma \cdot \sigma_{ratio} + \dots$ | Đã implement đúng dạng dimensionless | **Thấp** | Cảnh báo bug cũ không còn đúng. |
| **7** | **Skew** | Bonding Curve | Penalty Multiplier $K_{skew}$ | **Thấp** | Triển khai thông minh nhưng nhạy cảm với `pool_cap`. |
| **-** | **Stability** | Numeric guards tách theo đúng đơn vị | `epsilon` và `variance_floor` đã tách riêng | **Thấp** | Không còn câu chuyện “epsilon chặn đáy variance” như bản cũ. |

---

## 13. Tham số Môi trường & Argument chạy (Execution Args)

Hệ thống QTAP cho phép điều chỉnh một số hành vi thông qua biến môi trường (Environment Variables) trong `fortress/service.py`.

| Biến môi trường | Đơn vị | Mặc định | Ý nghĩa |
|---|---|---|---|
| `BINANCE_SYMBOL` | string | `BTCUSDT` | Cặp tiền giao dịch |
| `BINANCE_INTERVAL` | time | `1s` | Độ phân giải nến |
| `FORTRESS_MODES` | list | `5` | Danh sách mode nội bộ đang bật |
| `FORTRESS_LIVE_MC_N`| count | *(không set mặc định)* | Nếu set trong live mode, ép số paths MC cố định và tắt adaptive MC |
| `FORTRESS_PRICING_STRIDE`| s | `1` | Nhịp độ cập nhật giá khi Live (giây) |
| `FORTRESS_FAST_BOOT` | bool | `1` | Bỏ qua warmup dài để khởi động nhanh |
| `FORTRESS_FAST_WARMUP`| count | `2000` | Số tick warmup tối thiểu khi Fast Boot |
| `FORTRESS_FAST_MC_N`| count | `500` | Số paths MC dùng khi fast boot offline |
| `FORTRESS_PARKINSON_WEIGHT` | [1] | `0.0` | Explicit ablation knob cho Parkinson range-blend; main path disabled |
| `FORTRESS_PARKINSON_WEIGHT` | [1] | `0.0` | Explicit ablation knob; canonical default vẫn tắt |
