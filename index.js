const {
  createPostGraphileSchema,
  withPostGraphileContext
} = require("postgraphile");

/*
 * PostGraphile requires an authenticated pgClient to be on `context` when it
 * runs, and for that client to be released back to the pool when the request
 * completes/fails. In PostGraphile we wrap the GraphQL query with
 * `withPostGraphileContext to ensure that this is handled.
 *
 * Apollo Server has a `context` callback which can be used to generate the
 * context, but unfortunately it does not have a `releaseContext` method to
 * clear up the context once the request is done. We cannot provision the
 * pgClient in `context` itself (as would be cleanest) because certain error
 * conditions within Apollo Server would mean that we never get a chance to
 * release it.
 *
 * Instead we must use the lifecycle-hooks functionality in the latest Apollo
 * Server to write to the context when the request starts, and clear the
 * context when the result (success or error) will be sent.
 */

exports.makeSchemaAndPlugin = async (pgPool, dbSchema, postGraphileOptions) => {
  if (!pgPool || typeof pgPool !== "object") {
    throw new Error("The first argument must be a pgPool instance");
  }

  // See https://www.graphile.org/postgraphile/usage-schema/ for schema-only usage guidance
  const {
    pgSettings: pgSettingsGenerator,
    additionalGraphQLContextFromRequest,
    jwtSecret
  } = postGraphileOptions;

  function makePostgraphileApolloRequestHooks() {
    let finished;
    return {
      /*
       * Since `requestDidStart` itself is synchronous, we must hijack an
       * asynchronous callback in order to set up our context.
       */
      async didResolveOperation(requestContext) {
        const {
          context: graphqlContext,
          request: graphqlRequest
        } = requestContext;

        /*
         * Get access to the original HTTP request to determine the JWT and
         * also perform anything needed for pgSettings support.  (Actually this
         * is a subset of the original HTTP request according to the Apollo
         * Server typings, it only contains "headers"?)
         */
        const { http: req } = graphqlRequest;

        /*
         * The below code implements similar logic to this area of
         * PostGraphile:
         *
         * https://github.com/graphile/postgraphile/blob/ff620cac86f56b1cd58d6a260e51237c19df3017/src/postgraphile/http/createPostGraphileHttpRequestHandler.ts#L114-L131
         */

        // Extract the JWT if present:
        const jwtToken = jwtSecret ? getJwtToken(req) : null;

        // Extract additional context
        const additionalContext =
          typeof additionalGraphQLContextFromRequest === "function"
            ? await additionalGraphQLContextFromRequest(req /*, res */)
            : {};

        // Perform the `pgSettings` callback, if appropriate
        const pgSettings =
          typeof pgSettingsGenerator === "function"
            ? await pgSettingsGenerator(req)
            : pgSettingsGenerator;

        // Finally add our required properties to the context
        const withContextOptions = {
          ...postGraphileOptions,
          pgSettings,
          pgPool,
          jwtToken
        };
        await new Promise((resolve, reject) => {
          withPostGraphileContext(
            withContextOptions,
            postgrapileContext =>
              new Promise(releaseContext => {
                // Jesse, an Apollo Server developer, told me to do this 😜
                Object.assign(
                  graphqlContext,
                  additionalGraphQLContextFromRequest,
                  postgrapileContext
                );

                /*
                 * Don't resolve (don't release the pgClient on context) until
                 * the request is complete.
                 */
                finished = releaseContext;

                // The context is now ready to be used.
                resolve();
              })
          ).catch(e => {
            console.error("Error occurred creating context!");
            console.error(e);
            // Release context
            if (finished) {
              finished();
              finished = null;
            }

            reject(e);
          });
        });
      },
      willSendResponse(context) {
        // Release the context;
        if (finished) {
          finished();
          finished = null;
        }
      }
    };
  }

  const schema = await createPostGraphileSchema(
    pgPool,
    dbSchema,
    postGraphileOptions
  );

  const plugin = {
    requestDidStart() {
      return makePostgraphileApolloRequestHooks();
    }
  };

  return {
    schema,
    plugin
  };
};

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function createBadAuthorizationHeaderError() {
  return httpError(
    400,
    "Authorization header is not of the correct bearer scheme format."
  );
}

const authorizationBearerRex = /^\s*bearer\s+([a-z0-9\-._~+/]+=*)\s*$/i;
function getJwtToken(request) {
  const { authorization } = request.headers;
  if (Array.isArray(authorization)) throw createBadAuthorizationHeaderError();

  // If there was no authorization header, just return null.
  if (authorization == null) return null;

  const match = authorizationBearerRex.exec(authorization);

  // If we did not match the authorization header with our expected format,
  // throw a 400 error.
  if (!match) throw createBadAuthorizationHeaderError();

  // Return the token from our match.
  return match[1];
}
