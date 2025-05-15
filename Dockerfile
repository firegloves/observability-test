# Fetching the minified node image on apline linux
FROM node:22.15-slim

# Install corepack with pnpm
RUN npm install --global corepack@latest

# Setting up the work directory
WORKDIR /app

# Declaring env
ENV NODE_ENV=development

# COPY package.json and pnpm-lock.yaml
COPY package.json pnpm-lock.yaml* ./
# If pnpm-lock.yaml is not present, this will copy only package.json and proceed.
# The '*' after pnpm-lock.yaml is to handle cases where the file might not exist,
# preventing an error. Docker will simply skip copying it if it's not found.

# Copying all the files in our project
# This should happen AFTER pnpm install to avoid copying local node_modules
# and to ensure dependencies are built for the container's environment.
COPY . .

# Installing dependencies
RUN pnpm install

RUN pnpm build

# Exposing server port
EXPOSE 3000

# Starting our application
CMD [ "node", "dist/index.js" ]