import expectThrow from './helpers/expectThrow';
import time from './helpers/time';
import assertHelper from './helpers/assert';

const StoxSmartToken = artifacts.require('../contracts/StoxSmartToken.sol');
const VestingTrustee = artifacts.require('../contracts/VestingTrustee.sol');

contract('VestingTrustee', (accounts) => {
    const MINUTE = 60;
    const HOUR = 60 * MINUTE;
    const DAY = 24 * 60;
    const MONTH = 30 * DAY;
    const YEAR = 12 * MONTH;

    let now;
    let token;
    let trustee;

    beforeEach(async () => {
        now = web3.eth.getBlock(web3.eth.blockNumber).timestamp;

        token = await StoxSmartToken.new();
        trustee = await VestingTrustee.new(token.address);
    });

    let getGrant = async (address) => {
        let grant = await trustee.grants(address);

        return { granter: grant[0], value: grant[1], start: grant[2], cliff: grant[3], end: grant[4],
            transferred: grant[5] };
    }

    describe('construction', async () => {
        it('should be initialized with a valid address', async () => {
            await expectThrow(VestingTrustee.new());
        });

        it('should be ownable', async () => {
            assert.equal(await trustee.owner(), accounts[0]);
        });
    });

    describe('balance', async () => {
        it('should initially start with 0', async () => {
            assert.equal((await trustee.balance()).toNumber(), 0);
        });

        let balance = 1000;
        context(`with ${balance} tokens assigned to the trustee`, async () => {
            beforeEach(async () => {
                await token.issue(trustee.address, balance);
            });

            it(`should equal to ${balance}`, async () => {
                assert.equal((await trustee.balance()).toNumber(), balance);
            });

            it('should be able to update', async () => {
                let value = 10;

                await token.issue(trustee.address, value);
                assert.equal((await trustee.balance()).toNumber(), balance + value);
            });
        });
    });

    describe('grant', async () => {
        let balance = 10000;

        context(`with ${balance} tokens assigned to the trustee`, async() => {
            beforeEach(async () => {
                await token.issue(trustee.address, balance);
            });

            it('should initially have no grants', async () => {
                assert.equal((await trustee.totalVesting()).toNumber(), 0);
            });

            it('should not allow granting to 0', async () => {
                await expectThrow(trustee.grant(0, 1000, now, now, now + 10 * YEAR));
            });

            it('should not allow granting 0 tokens', async () => {
                await expectThrow(trustee.grant(accounts[0], 0, now, now, now + 3 * YEAR));
            });

            it('should not allow granting with a cliff before the start', async () => {
                await expectThrow(trustee.grant(accounts[0], 0, now, now - 1, now + 10 * YEAR));
            });

            it('should not allow granting with a cliff after the vesting', async () => {
                await expectThrow(trustee.grant(accounts[0], 0, now, now + YEAR, now + MONTH));
            });

            it('should not allow granting tokens more than once', async () => {
                await trustee.grant(accounts[0], 1000, now, now, now + 10 * YEAR);

                await expectThrow(trustee.grant(accounts[0], 1000, now, now, now + 10 * YEAR));
            });

            it('should not allow granting from not an owner', async () => {
                await expectThrow(trustee.grant(accounts[0], 1000, now, now + MONTH, now + YEAR, {from: accounts[1]}));
            });

            it('should not allow granting more than the balance in a single grant', async () => {
                await expectThrow(trustee.grant(accounts[0], balance + 1, now, now + MONTH, now + YEAR));
            });

            it('should not allow granting more than the balance in multiple grants', async () => {
                await trustee.grant(accounts[0], balance - 10, now, now + MONTH, now + YEAR);
                await trustee.grant(accounts[1], 7, now, now + MONTH, now + YEAR);
                await trustee.grant(accounts[2], 3, now, now + 5 * MONTH, now + YEAR);

                await expectThrow(trustee.grant(accounts[3], 1, now, now, now + YEAR));
            });

            it('should record a grant and increase grants count and total vesting', async () => {
                let totalVesting = (await trustee.totalVesting()).toNumber();
                assert.equal(totalVesting, 0);

                let value = 1000;
                let start = now;
                let cliff = now + MONTH;
                let end = now + YEAR;
                await trustee.grant(accounts[0], value, start, cliff, end);

                assert.equal((await trustee.totalVesting()).toNumber(), totalVesting + value);
                let grant = await getGrant(accounts[0]);
                assert.equal(grant.granter, accounts[0]);
                assert.equal(grant.value, value);
                assert.equal(grant.start, start);
                assert.equal(grant.cliff, cliff);
                assert.equal(grant.end, end);
                assert.equal(grant.transferred, 0);

                let value2 = 2300;
                let start2 = now + 2 * MONTH;
                let cliff2 = now + 6 * MONTH;
                let end2 = now + YEAR;
                await trustee.grant(accounts[1], value2, start2, cliff2, end2);

                assert.equal((await trustee.totalVesting()).toNumber(), totalVesting + value + value2);
                let grant2 = await getGrant(accounts[1]);
                assert.equal(grant2.granter, accounts[0]);
                assert.equal(grant2.value, value2);
                assert.equal(grant2.start, start2);
                assert.equal(grant2.cliff, cliff2);
                assert.equal(grant2.end, end2);
                assert.equal(grant2.transferred, 0);
            });
        });
    });

    describe('vestedTokens', async () => {
        let balance = 10 ** 12;

        beforeEach(async () => {
            await token.issue(trustee.address, balance);
        });

        it('should return 0 for non existing grant', async () => {
            let holder = accounts[5];
            let grant = await getGrant(holder);

            assert.equal(grant.granter, 0);
            assert.equal((await trustee.vestedTokens(holder, now + 100 * YEAR)).toNumber(), 0);
        });

        [
            {
                tokens: 1000, startOffset: 0, cliffOffset: MONTH, endOffset: YEAR, results: [
                    { offset: 0, vested: 0 },
                    { offset: MONTH - 1, vested: 0 },
                    { offset: MONTH, vested: Math.floor(1000 / 12) },
                    { offset: 2 * MONTH, vested: 2 * Math.floor(1000 / 12) },
                    { offset: 0.5 * YEAR, vested: 1000 / 2 },
                    { offset: YEAR, vested: 1000 },
                    { offset: YEAR + DAY, vested: 1000 }
                ]
            },
            {
                tokens: 10000, startOffset: 0, cliffOffset: 0, endOffset: 4 * YEAR, results: [
                    { offset: 0, vested: 0 },
                    { offset: MONTH, vested: Math.floor(10000 / 12 / 4) },
                    { offset: 0.5 * YEAR, vested: 10000 / 8 },
                    { offset: YEAR, vested: 10000 / 4 },
                    { offset: 2 * YEAR, vested: 10000 / 2 },
                    { offset: 3 * YEAR, vested: 10000 * 0.75 },
                    { offset: 4 * YEAR, vested: 10000 },
                    { offset: 4 * YEAR + MONTH, vested: 10000 }
                ]
            },
            {
                tokens: 10000, startOffset: 0, cliffOffset: YEAR, endOffset: 4 * YEAR, results: [
                    { offset: 0, vested: 0 },
                    { offset: MONTH, vested: 0 },
                    { offset: 0.5 * YEAR, vested: 0 },
                    { offset: YEAR, vested: 10000 / 4 },
                    { offset: 2 * YEAR, vested: 10000 / 2 },
                    { offset: 3 * YEAR, vested: 10000 * 0.75 },
                    { offset: 4 * YEAR, vested: 10000 },
                    { offset: 4 * YEAR + MONTH, vested: 10000 }
                ]
            },
            {
                tokens: 100000000, startOffset: 0, cliffOffset: 0, endOffset: 2 * YEAR, results: [
                    { offset: 0, vested: 0 },
                    { offset: MONTH, vested: Math.floor(100000000 / 12 / 2) },
                    { offset: 0.5 * YEAR, vested: 100000000 / 4 },
                    { offset: YEAR, vested: 100000000 / 2 },
                    { offset: 2 * YEAR, vested: 100000000 },
                    { offset: 3 * YEAR, vested: 100000000 }
                ]
            },
        ].forEach((grant) => {
            context(`grant: ${grant.tokens}, startOffset: ${grant.startOffset}, cliffOffset: ${grant.cliffOffset}, ` +
                `endOffset: ${grant.endOffset}`, async () => {

                beforeEach(async () => {
                    await trustee.grant(accounts[2], grant.tokens, now + grant.startOffset, now + grant.cliffOffset,
                        now + grant.endOffset);
                });

                grant.results.forEach(async (res) => {
                    it(`should vest ${res.vested} out of ${grant.tokens} at time offset ${res.offset}`, async () => {
                        let result = (await trustee.vestedTokens(accounts[2], now + res.offset)).toNumber();
                        assert.equal(result, res.vested);
                    });
                });
            });
        });
    });

    describe('unlockVestedTokens', async () => {
        // We'd allow (up to) 10 tokens vesting error, due to possible timing differences during the tests.
        const MAX_ERROR = 10;

        let balance = 10 ** 12;

        beforeEach(async () => {
            await token.issue(trustee.address, balance);
        });

        it('should not allow unlocking a non-existing grant', async () => {
            let holder = accounts[5];
            let grant = await getGrant(holder);

            assert.equal(grant.granter, 0);

            await expectThrow(trustee.unlockVestedTokens({from: holder}));
        });

        [
            {
                tokens: 1000, startOffset: 0, cliffOffset: MONTH, endOffset: YEAR, results: [
                    { diff: 0, unlocked: 0 },
                    // 1 day before the cliff.
                    { diff: MONTH - DAY, unlocked: 0 },
                    // At the cliff.
                    { diff: DAY, unlocked: 83 },
                    // 1 second after che cliff and previous unlock/withdraw.
                    { diff: 1, unlocked: 0 },
                    // 1 month after the cliff.
                    { diff: MONTH - 1, unlocked: 83 },
                    // At half of the vesting period.
                    { diff: 4 * MONTH, unlocked: 1000 / 2 - 2 * 83 },
                    // At the end of the vesting period.
                    { diff: 6 * MONTH, unlocked: 1000 / 2 },
                    // After the vesting period, with everything already unlocked and withdrawn.
                    { diff: DAY, unlocked: 0 }
                ]
            },
            {
                tokens: 1000, startOffset: 0, cliffOffset: MONTH, endOffset: YEAR, results: [
                    { diff: 0, unlocked: 0 },
                    // 1 day after the vesting period.
                    { diff: YEAR + DAY, unlocked: 1000 },
                    // 1 year after the vesting period.
                    { diff: YEAR - DAY, unlocked: 0 }
                ]
            },
            {
                tokens: 1000000, startOffset: 0, cliffOffset: 0, endOffset: 4 * YEAR, results: [
                    { diff: 0, unlocked: 0 },
                    { diff: YEAR, unlocked: 1000000 / 4 },
                    { diff: YEAR, unlocked: 1000000 / 4 },
                    { diff: YEAR, unlocked: 1000000 / 4 },
                    { diff: YEAR, unlocked: 1000000 / 4 },
                    { diff: YEAR, unlocked: 0 }
                ]
            }
        ].forEach(async (grant) => {
            context(`grant: ${grant.tokens}, startOffset: ${grant.startOffset}, cliffOffset: ${grant.cliffOffset}, ` +
                `endOffset: ${grant.endOffset}`, async () => {

                let holder = accounts[1];

                beforeEach(async () => {
                    await trustee.grant(holder, grant.tokens, now + grant.startOffset, now + grant.cliffOffset, now +
                        grant.endOffset);

                });

                it('should unlock tokens according to the schedule', async () => {
                    for (let res of grant.results) {
                        console.log(`\texpecting ${res.unlocked} tokens unlocked and transferred after another ` +
                            `${res.diff} seconds`);

                        // Get previous state.
                        let totalVesting = (await trustee.totalVesting()).toNumber();
                        let trusteeBalance = (await trustee.balance()).toNumber();
                        let userBalance = (await token.balanceOf(holder)).toNumber();
                        let transferred = (await getGrant(holder)).transferred.toNumber();

                        // Jump forward in time by the requested diff.
                        await time.increaseTime(res.diff);
                        await trustee.unlockVestedTokens({from: holder});

                        // Verify new state.
                        assertHelper.around((await trustee.totalVesting()).toNumber(), totalVesting - res.unlocked,
                            MAX_ERROR);
                        assertHelper.around((await trustee.balance()).toNumber(), trusteeBalance - res.unlocked,
                            MAX_ERROR);
                        assertHelper.around((await token.balanceOf(holder)).toNumber(), userBalance + res.unlocked,
                            MAX_ERROR);
                        assertHelper.around((await getGrant(holder)).transferred.toNumber(), transferred + res.unlocked,
                            MAX_ERROR);
                    }
                });
            });
        });
    });
});
