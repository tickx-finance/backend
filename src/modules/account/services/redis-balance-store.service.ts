import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { BalanceDelta, BalanceState } from '../types';

export interface AtomicBalanceMutation {
    status: 'APPLIED' | 'DUPLICATE';
    balance: BalanceState;
}

const ATOMIC_APPLY_BALANCE_DELTA_SCRIPT = `
local function normalize(n)
  n = tostring(n)
  local sign = ''
  if string.sub(n, 1, 1) == '-' then
    sign = '-'
    n = string.sub(n, 2)
  end
  n = string.gsub(n, '^0+', '')
  if n == '' then
    return '0'
  end
  return sign .. n
end

local function is_negative(n)
  return string.sub(normalize(n), 1, 1) == '-'
end

local function abs_value(n)
  n = normalize(n)
  if string.sub(n, 1, 1) == '-' then
    return string.sub(n, 2)
  end
  return n
end

local function cmp_abs(a, b)
  a = abs_value(a)
  b = abs_value(b)
  if string.len(a) ~= string.len(b) then
    if string.len(a) > string.len(b) then return 1 else return -1 end
  end
  if a == b then return 0 end
  if a > b then return 1 else return -1 end
end

local function add_abs(a, b)
  a = abs_value(a)
  b = abs_value(b)
  local carry = 0
  local out = ''
  local i = string.len(a)
  local j = string.len(b)
  while i > 0 or j > 0 or carry > 0 do
    local da = 0
    local db = 0
    if i > 0 then da = tonumber(string.sub(a, i, i)); i = i - 1 end
    if j > 0 then db = tonumber(string.sub(b, j, j)); j = j - 1 end
    local sum = da + db + carry
    out = tostring(sum % 10) .. out
    carry = math.floor(sum / 10)
  end
  return normalize(out)
end

local function sub_abs(a, b)
  a = abs_value(a)
  b = abs_value(b)
  local borrow = 0
  local out = ''
  local i = string.len(a)
  local j = string.len(b)
  while i > 0 do
    local da = tonumber(string.sub(a, i, i)) - borrow
    local db = 0
    if j > 0 then db = tonumber(string.sub(b, j, j)); j = j - 1 end
    if da < db then
      da = da + 10
      borrow = 1
    else
      borrow = 0
    end
    out = tostring(da - db) .. out
    i = i - 1
  end
  return normalize(out)
end

local function add_signed(a, b)
  a = normalize(a)
  b = normalize(b)
  local an = is_negative(a)
  local bn = is_negative(b)
  if an == bn then
    local sum = add_abs(a, b)
    if an and sum ~= '0' then return '-' .. sum end
    return sum
  end
  local cmp = cmp_abs(a, b)
  if cmp == 0 then return '0' end
  if cmp > 0 then
    local diff = sub_abs(a, b)
    if an then return '-' .. diff end
    return diff
  end
  local diff = sub_abs(b, a)
  if bn then return '-' .. diff end
  return diff
end

local stateKey = KEYS[1]
local dedupKey = KEYS[2]
local freeDelta = ARGV[1]
local freeTapDelta = ARGV[2]
local lockedDelta = ARGV[3]
local initFree = ARGV[4]
local initFreeTap = ARGV[5]
local initLocked = ARGV[6]
local initLedgerSeq = ARGV[7]

if redis.call('EXISTS', dedupKey) == 1 then
  return {
    'DUPLICATE',
    redis.call('HGET', stateKey, 'free') or initFree,
    redis.call('HGET', stateKey, 'freeTap') or initFreeTap,
    redis.call('HGET', stateKey, 'locked') or initLocked,
    redis.call('HGET', stateKey, 'ledgerSeq') or initLedgerSeq
  }
end

if redis.call('EXISTS', stateKey) == 0 then
  redis.call('HSET', stateKey, 'free', initFree, 'freeTap', initFreeTap, 'locked', initLocked, 'ledgerSeq', initLedgerSeq)
end

local free = redis.call('HGET', stateKey, 'free') or '0'
local freeTap = redis.call('HGET', stateKey, 'freeTap') or '0'
local locked = redis.call('HGET', stateKey, 'locked') or '0'
local ledgerSeq = redis.call('HGET', stateKey, 'ledgerSeq') or '0'

local newFree = add_signed(free, freeDelta)
local newFreeTap = add_signed(freeTap, freeTapDelta)
local newLocked = add_signed(locked, lockedDelta)

if is_negative(newFree) or is_negative(newFreeTap) or is_negative(newLocked) then
  return {'INSUFFICIENT', free, freeTap, locked, ledgerSeq}
end

local newLedgerSeq = add_signed(ledgerSeq, '1')
redis.call('HSET', stateKey, 'free', newFree, 'freeTap', newFreeTap, 'locked', newLocked, 'ledgerSeq', newLedgerSeq)
redis.call('SET', dedupKey, newLedgerSeq)

return {'APPLIED', newFree, newFreeTap, newLocked, newLedgerSeq}
`;

@Injectable()
export class RedisBalanceStoreService {
    constructor(@InjectRedis() private readonly redis: Redis) { }

    async get(userId: string): Promise<BalanceState | undefined> {
        const values = await this.redis.hmget(this.stateKey(userId), 'free', 'freeTap', 'locked', 'ledgerSeq');
        if (values.every((value) => value == null)) {
            return undefined;
        }

        return {
            userId,
            free: values[0] ?? '0',
            freeTap: values[1] ?? '0',
            locked: values[2] ?? '0',
            lastLedgerSeq: values[3] ?? '0',
        };
    }

    async set(userId: string, balance: BalanceState): Promise<void> {
        await this.redis.hset(this.stateKey(userId), {
            free: balance.free,
            freeTap: balance.freeTap,
            locked: balance.locked,
            ledgerSeq: balance.lastLedgerSeq,
        });
    }

    async applyDelta(
        userId: string,
        economicKey: string,
        delta: BalanceDelta,
        initialBalance: BalanceState,
    ): Promise<AtomicBalanceMutation> {
        this.assertIntegerDelta(delta);

        const result = await this.redis.eval(
            ATOMIC_APPLY_BALANCE_DELTA_SCRIPT,
            2,
            this.stateKey(userId),
            this.dedupKey(userId, economicKey),
            delta.free,
            delta.freeTap,
            delta.locked,
            initialBalance.free,
            initialBalance.freeTap,
            initialBalance.locked,
            initialBalance.lastLedgerSeq,
        ) as string[];

        const [status, free, freeTap, locked, ledgerSeq] = result;
        const balance: BalanceState = {
            userId,
            free,
            freeTap,
            locked,
            lastLedgerSeq: ledgerSeq,
        };

        if (status === 'INSUFFICIENT') {
            throw new BadRequestException('Insufficient balance');
        }

        if (status !== 'APPLIED' && status !== 'DUPLICATE') {
            throw new Error(`Unexpected Redis balance mutation status: ${status}`);
        }

        return { status, balance };
    }

    private assertIntegerDelta(delta: BalanceDelta) {
        for (const value of [delta.free, delta.freeTap, delta.locked]) {
            if (!/^-?\d+$/.test(value)) {
                throw new BadRequestException('Balance delta must be an integer base-unit string');
            }
        }
    }

    private stateKey(userId: string): string {
        return `account:{${userId}}:state`;
    }

    private dedupKey(userId: string, economicKey: string): string {
        return `account:{${userId}}:dedup:${economicKey}`;
    }
}
