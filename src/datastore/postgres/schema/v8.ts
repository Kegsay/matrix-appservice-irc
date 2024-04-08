import { PoolClient } from "pg";
import { Logger } from "matrix-appservice-bridge";

const log = new Logger('postgres/schema/v8');

function domainSetToValues(domains: string[], count: number): [string, Array<string|number|null>] {
    let res = "";
    const values: Array<string|number|null> = [];
    // VALUES ...
    for (let index = 0; index < domains.length; index++) {
        const i = index * 3;
        if (res) {
            res += ", ";
        }
        res += `($${i+1}, $${i+2}, $${i+3})`;
        values.push(count, "*", domains[index]);
    }
    return [res, values];
}

export async function runSchema(connection: PoolClient) {

    await connection.query(`
        ALTER TABLE ipv6_counter
        ADD COLUMN homeserver TEXT,
        ADD COLUMN server TEXT;
        ALTER TABLE ipv6_counter
        ADD CONSTRAINT cons_ipv6_counter_unique UNIQUE(homeserver, server);
    `);


    // Migrate data.
    const existingCounterRes = await connection.query<{count: string}>("SELECT count FROM ipv6_counter;");
    const existingCounter = existingCounterRes && parseInt(existingCounterRes.rows[0].count, 10);

    // If we have a counter value
    if (existingCounter) {
        const serverConfigsRes = await connection.query<{domain: string}>(
            "SELECT DISTINCT domain FROM client_config WHERE config->>'ipv6' IS NOT NULL;"
        );
        if (serverConfigsRes.rowCount === 0) {
            // No servers to migrate?
            throw Error("No client_configs found with ipv6 addresses, but counter was found");
        }
        else if (serverConfigsRes.rowCount! > 1) {
            log.warn("More than one IPv6 server configured, starting both ipv6 counters from the same value.");
        }
        // Because we cannot determine which IRC network(s) are using the existing counter
        // (owing to a bug where we treated the counter as global across all networks), this assumes
        // that both networks start from the same counter value.
        const [statement, values] = domainSetToValues(serverConfigsRes.rows.map(d => d.domain), existingCounter);
        await connection.query(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            `INSERT INTO ipv6_counter (count, homeserver, server) VALUES ${statement}`, values as any[]
        );
    }

    await connection.query(`
        DELETE FROM ipv6_counter WHERE server IS NULL;
        ALTER TABLE ipv6_counter ALTER COLUMN server SET NOT NULL;
    `);
}
