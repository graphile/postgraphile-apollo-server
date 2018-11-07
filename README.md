# postgraphile-apollo-server

This module performs some of the boilerplate for using PostGraphile with Apollo
Server.

## Usage

```js
const pg = require("pg");
const { ApolloServer } = require("apollo-server");
const { makeSchemaAndPlugin } = require("postgraphile-apollo-server");

const pgPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL
});

async function main() {
  const { schema, plugin } = await makeSchemaAndPlugin(
    pgPool,
    'public', // PostgreSQL schema to use
    {
      // PostGraphile options, see:
      // https://www.graphile.org/postgraphile/usage-library/
    }
  );

  const server = new ApolloServer({
    schema,
    plugins: [plugin]
  });

  const { url } = await server.listen();
  console.log(`🚀 Server ready at ${url}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
```

## Limitations

Not all PostGraphile library options are supported at this time; for example
`watchPg` is not.

## Example

https://github.com/graphile/postgraphile-example-apollo-server

## TODO:

- [ ] Improve this README!
- [ ] Compile a list of the unsupported PostGraphile library options
- [ ] Don't require a `pgPool` to be passed - allow a connection string instead
- [ ] Add tests
