#Use Node 22 
FROM node:22

#Set working dir
WORKDIR /app

#Copy package files first to use caching
COPY package*.json ./

#Install dependencies
RUN npm install

#Copy the rest of the code
COPY . .


COPY .env.build .env


#Build the project
RUN npm run build

#Expose the port 3000
EXPOSE 3000



# run the project
CMD ["npm", "run", "preview", "--", "--port", "3000", "--host"]