FROM node:16

WORKDIR /app

COPY package.json .

RUN  npm install -y

RUN npm install -g nodemon 

COPY . . 

EXPOSE 3333 

CMD ["nodemon","server.js"]


