# Hackathon Feature Status

Mục tiêu của bảng này là phân biệt rõ:
- phần nào đã đủ dùng cho demo hackathon
- phần nào còn rủi ro, có thể không kịp và nên mock để không chặn flow demo

| Feature | Status | Mức sẵn sàng cho hackathon | Nếu không kịp thì mock gì |
|---|---|---|---|
| Wallet auth bằng signed challenge | Available | Dùng được ngay | Không cần mock |
| World mini-app login bằng SIWE | Available, nhưng còn phụ thuộc payload/RPC thật | Dùng được nếu payload World App và RPC đúng | Mock `verifyLogin` thành trả address hợp lệ |
| World mini-app verify human riêng | Available, nhưng còn phụ thuộc proof provider thật | Có thể demo nếu proof thật chạy ổn | Mock `WorldApp.verifyHuman()` trả `true` |
| Phân loại user theo `authType` + `humanVerified` | Available | Dùng được ngay | Không cần mock |
| Persist mini-app metadata (`miniAppUserId`, `miniAppUsername`) | Available | Dùng được ngay | Không cần mock |
| Account balance ledger trên Postgres + Redis atomic lock/seq | Available | Dùng được ngay | Không cần mock |
| Deposit faucet debug để nạp tiền demo | Available | Rất phù hợp cho hackathon | Giữ nguyên |
| Payment deposit sync từ contract event | Có code path nhưng tạm không dùng cho hackathon | Không nằm trong flow demo hiện tại | Fallback về `debug/deposit` |
| Withdraw session + admin claim signer | Có code path nhưng tạm không dùng cho hackathon | Không nằm trong flow demo hiện tại | Fallback về debug withdraw flow |
| Payment worker riêng + `/health` | Available nhưng tạm không chạy trong hackathon flow | Không cần cho demo hiện tại | Không chạy worker sync |
| Price stream realtime | Available | Dùng được ngay | Không cần mock |
| Grid service mặc định dùng Fortress | Available | Dùng được ngay | Không cần mock |
| Fortress adaptive band width / adaptive MC path count | Available | Dùng được ngay | Không cần mock |
| Stream MC diagnostics (`paths` + `pRaw`) | Available qua env flag | Dùng được nếu cần visualization cho demo kỹ thuật | Có thể tắt bằng env nếu không cần |
| Order placement / settlement end-to-end | Available | Dùng được ngay | Không cần mock |
| Human verified win bonus ở settlement | Available | Dùng được ngay | Nếu verify-human khó chạy, mock `humanVerified=true` ở profile |
| Follow KOL / follow order updates qua socket | Available | Dùng được ngay cho demo social feature | Không cần mock |
| Benchmarks (`benchmark:e2e:slo`, `benchmark:fortress:grid`) | Available | Dùng được cho demo kỹ thuật nội bộ, không bắt buộc cho demo sản phẩm | Bỏ khỏi demo nếu thiếu thời gian |
| Integration tests cho account/order/auth | Available một phần | Dùng được cho internal confidence | Nếu thiếu env test DB/Redis thì chỉ chạy unit tests |
| World App SIWE v2 cho mọi ví mini-app thực tế | Rủi ro còn lại | Có thể fail nếu payload/runtime wallet không đúng EIP-1271 assumption | Mock verifier login ở môi trường demo |
| Human proof nullifier uniqueness + lock | Available | Dùng được ngay | Không cần mock |
| Payment production flow full on-chain (deposit + withdraw + expiry + confirmation) | Tạm loại khỏi hackathon flow | Không phải phần bắt buộc cho demo | Deposit/withdraw fallback về debug API |
| Full demo với infra thật: Postgres + Redis + RPC + payment worker + app worker | Không phải mode demo hiện tại | Không cần cho hackathon | Chạy app chính, không chạy payment sync worker |

## Khuyến nghị demo hackathon

Flow an toàn nhất để demo:

1. login bằng wallet hoặc mini-app
2. debug deposit
3. stream price + grid
4. đặt lệnh
5. settlement
6. bonus cho user đã human verified
7. follow trade update của KOL qua socket

## Những phần nên mock nếu thời gian ngắn

| Phần nên mock | Lý do |
|---|---|
| World mini-app verify human thật | Phụ thuộc proof provider thật và env đúng |
| World mini-app SIWE v2 cho mọi wallet mini-app | Có thể phát sinh edge case EIP-1271 / RPC / payload format |
| Payment on-chain deposit sync | Tạm không dùng trong hackathon, thay bằng debug deposit |
| Payment withdraw success on-chain | Tạm không dùng trong hackathon, thay bằng debug withdraw flow |

## Cấu hình demo đề xuất

- Bật app chính
- Không chạy payment sync worker trong hackathon flow
- Dùng debug deposit thay cho deposit on-chain thật
- Dùng debug withdraw flow thay cho withdraw on-chain thật
- Chỉ bật MC diagnostics khi cần màn hình kỹ thuật:
  - `FORTRESS_STREAM_MC_DIAGNOSTICS=true`
- Chỉ chạy auth e2e khi có test infra:
  - `RUN_AUTH_E2E=true`
  - `POSTGRES_TEST_URL=...`
  - `REDIS_TEST_URL=...`
