#!/bin/zsh
# Differential against main: the local gate for "nothing major breaks for current users".
#
#   apps/api/test/helpers/mainDiff/run.sh [sqlite|pg|mysql] [seed] [steps]
#
# 1. Extracts main (`git archive main | tar -x`, read-only on the repository) into the scratch directory, with
#    links to this repository's installed packages (main's own @shapio packages linked to main's sources).
# 2. Seed, on main: one database gets the schema, callers and content through main's API, in 0.8.2 terms.
# 3. The seeded database is copied twice. Main replays a deterministic workload of reads and writes from every
#    caller kind on one copy; the branch opens the other (its migrations upgrade it, as an upgrade would) and
#    replays the same workload.
# 4. diff.mjs compares every observable step by step: status, error code, issues, response body (item IDs and
#    times left out), stored content (without `__id`), revisions, versions, publish status, outbox events, audit
#    rows. Every difference must match allowlist.json, whose entries cite CHANGELOG.md or
#    documentation/upgrades.md; any other difference fails (exit 1).
#
# Databases are created and dropped by this script (names shapio_md_*); nothing else is touched. Not run in CI.
set -e
HERE=${0:A:h}
REPO=${HERE:h:h:h:h:h}
SCRATCH=${MAIN_DIFF_SCRATCH:-/private/tmp/claude-501/-Users-brad-Development-shapio/bd7733ea-70bf-4c12-8f20-ba7388cf8dcd/scratchpad/maindiff}
DIALECT=${1:-sqlite}
SEED=${2:-1}
STEPS=${3:-120}
MAIN=$SCRATCH/main
OUT=$SCRATCH/out-$DIALECT-$SEED
mkdir -p $SCRATCH $OUT

# 1. main, extracted fresh each run.
rm -rf $MAIN && mkdir -p $MAIN
git -C $REPO archive main | tar -x -C $MAIN
ln -s $REPO/node_modules $MAIN/node_modules
link_modules() { # <main package dir> <repo package dir>
  [ -d $2/node_modules ] || return 0
  mkdir -p $1/node_modules
  for entry in $2/node_modules/*(N) $2/node_modules/.bin(N); do
    name=${entry:t}
    [ "$name" = "@shapio" ] && continue
    ln -s $entry $1/node_modules/$name
  done
  if [ -d $2/node_modules/@shapio ]; then
    mkdir -p $1/node_modules/@shapio
    for entry in $2/node_modules/@shapio/*(N); do ln -s $MAIN/packages/${entry:t} $1/node_modules/@shapio/${entry:t}; done
  fi
}
link_modules $MAIN/apps/api $REPO/apps/api
for package in $MAIN/packages/*(N/); do link_modules $package $REPO/packages/${package:t}; done

# The branch side is this working tree; MAIN_DIFF_BRANCH_REF=<commit> extracts that commit instead (to check that
# the differential catches a regression an earlier commit had).
BRANCH=$REPO
if [ -n "$MAIN_DIFF_BRANCH_REF" ]; then
  BRANCH=$SCRATCH/branchref
  rm -rf $BRANCH && mkdir -p $BRANCH
  git -C $REPO archive $MAIN_DIFF_BRANCH_REF | tar -x -C $BRANCH
  ln -s $REPO/node_modules $BRANCH/node_modules
  MAIN_SAVED=$MAIN; MAIN=$BRANCH
  link_modules $BRANCH/apps/api $REPO/apps/api
  for package in $BRANCH/packages/*(N/); do link_modules $package $REPO/packages/${package:t}; done
  MAIN=$MAIN_SAVED
fi
VITEST=$REPO/apps/api/node_modules/.bin/vitest
side() { # <repo> <phase> <url>
  MAIN_DIFF_REPO=$1 MAIN_DIFF_PHASE=$2 MAIN_DIFF_DB=$3 MAIN_DIFF_MANIFEST=$OUT/manifest.json MAIN_DIFF_OUT=$OUT/$4.json \
    MAIN_DIFF_SEED=$SEED MAIN_DIFF_STEPS=$STEPS VITE_CONFIG_NATIVE_IGNORE_WARNING=true \
    $VITEST run --config $HERE/vitest.config.ts > $OUT/$4.log 2>&1 || { echo "$4 failed: $OUT/$4.log"; tail -30 $OUT/$4.log; exit 2; }
}
pg_admin() { # <statement>
  node -e "const pg=require('$REPO/apps/api/node_modules/pg');const c=new pg.Client({connectionString:process.argv[1]});c.connect().then(()=>c.query(process.argv[2])).then(()=>c.end()).catch((e)=>{console.error(e.message);process.exit(1)})" "$ADMIN" "$1"
}
case $DIALECT in
  sqlite)
    rm -f $OUT/*.db(N)
    side $MAIN seed sqlite:$OUT/seed.db seed
    cp $OUT/seed.db $OUT/main.db; cp $OUT/seed.db $OUT/branch.db
    side $MAIN replay sqlite:$OUT/main.db main
    side $BRANCH replay sqlite:$OUT/branch.db branch
    ;;
  pg)
    ADMIN=${MAIN_DIFF_PG:-$(grep '^TEST_DATABASE_URL=' $REPO/.env | cut -d= -f2-)}
    base=${ADMIN%/*}
    tag=shapio_md_$$
    for name in seed main branch; do pg_admin "drop database if exists ${tag}_$name"; done
    pg_admin "create database ${tag}_seed"
    side $MAIN seed $base/${tag}_seed seed
    pg_admin "create database ${tag}_main template ${tag}_seed"
    pg_admin "create database ${tag}_branch template ${tag}_seed"
    side $MAIN replay $base/${tag}_main main
    side $BRANCH replay $base/${tag}_branch branch
    for name in seed main branch; do pg_admin "drop database if exists ${tag}_$name with (force)"; done
    ;;
  *) echo "usage: run.sh [sqlite|pg] [seed] [steps]"; exit 64 ;;
esac
node $HERE/diff.mjs $OUT/main.json $OUT/branch.json $HERE/allowlist.json
