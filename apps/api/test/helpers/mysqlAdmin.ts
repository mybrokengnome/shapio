import mysql from 'mysql2/promise';
import { mysqlPoolOptions } from '../../src/db/mysql/driver.js';

/**
 * Test-database administration on MySQL, which has no `CREATE DATABASE … TEMPLATE`: a test database is
 * cloned from the migrated template by replaying its `SHOW CREATE TABLE`/`TRIGGER` statements and copying
 * its rows (the seed rows and the migration history).
 */
const DATABASE_OPTIONS = 'character set utf8mb4 collate utf8mb4_0900_bin';

const connect = (adminUrl: string) =>
  mysql.createConnection({ ...mysqlPoolOptions(adminUrl, 1), typeCast: true });

const quote = (identifier: string) => `\`${identifier.replaceAll('`', '``')}\``;

/** Runs statements on one admin connection (no database selected unless a statement says so). */
export const runMysqlAdmin = async (adminUrl: string, ...statements: string[]): Promise<void> => {
  const connection = await connect(adminUrl);
  try {
    for (const statement of statements) {
      await connection.query(statement);
    }
  } finally {
    await connection.end();
  }
};

export const createMysqlDatabase = (adminUrl: string, name: string): Promise<void> =>
  runMysqlAdmin(
    adminUrl,
    `drop database if exists ${quote(name)}`,
    `create database ${quote(name)} ${DATABASE_OPTIONS}`,
  );

export const dropMysqlDatabase = (adminUrl: string, name: string): Promise<void> =>
  runMysqlAdmin(adminUrl, `drop database if exists ${quote(name)}`);

/** Creates `name` as a copy of `template`: tables, foreign keys, triggers and rows. */
export const cloneMysqlDatabase = async (adminUrl: string, template: string, name: string): Promise<void> => {
  const connection = await connect(adminUrl);
  try {
    await connection.query(`create database ${quote(name)} ${DATABASE_OPTIONS}`);
    await connection.query(`use ${quote(name)}`);
    await connection.query('set foreign_key_checks = 0');
    const [tables] = await connection.query<mysql.RowDataPacket[]>(
      `select table_name as name from information_schema.tables
       where table_schema = ? and table_type = 'BASE TABLE' order by table_name`,
      [template],
    );
    for (const { name: table } of tables as { name: string }[]) {
      const [[created]] = await connection.query<mysql.RowDataPacket[]>(
        `show create table ${quote(template)}.${quote(table)}`,
      );
      await connection.query(String((created as Record<string, unknown>)['Create Table']));
      await connection.query(`insert into ${quote(table)} select * from ${quote(template)}.${quote(table)}`);
    }
    const [triggers] = await connection.query<mysql.RowDataPacket[]>(`show triggers from ${quote(template)}`);
    for (const trigger of triggers as { Trigger: string }[]) {
      const [[definition]] = await connection.query<mysql.RowDataPacket[]>(
        `show create trigger ${quote(template)}.${quote(trigger.Trigger)}`,
      );
      await connection.query(String((definition as Record<string, unknown>)['SQL Original Statement']));
    }
  } finally {
    await connection.end();
  }
};
